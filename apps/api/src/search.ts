import { fuse, MAX_K, type SignalHits } from "@framesearch/core";
import {
  frameKey,
  type Hit,
  type RankedShot,
  type SearchReply,
} from "@framesearch/schema";
import { type Embeddings, embedQuery } from "./embeddings.ts";
import type { Env } from "./env.ts";
import { ftsMatch } from "./fts.ts";
import { loadVectors, type Published } from "./vectors.ts";

const D1_PARAMETER_LIMIT = 100;

interface ShotRow {
  id: number;
  film: string;
  idx: number;
  time: number;
  shotStart: number;
  shotEnd: number;
  caption: string | null;
  tags: string;
  title: string;
}

interface KeywordRow {
  id: number;
  score: number;
}

const SAME_SHOT_QUERY =
  "SELECT sibling.id FROM shots s JOIN shots sibling ON sibling.film = s.film AND sibling.shot_start = s.shot_start AND sibling.shot_end = s.shot_end WHERE s.id = ?1";
const KEYWORD_QUERY =
  "SELECT rowid AS id, bm25(shots_fts) AS score FROM shots_fts WHERE shots_fts MATCH ?1 ORDER BY score LIMIT ?2";
const KEYWORD_QUERY_FILM =
  "SELECT f.rowid AS id, bm25(shots_fts) AS score FROM shots_fts f JOIN shots s ON s.id = f.rowid WHERE shots_fts MATCH ?1 AND s.film = ?2 ORDER BY score LIMIT ?3";

export interface SearchInput {
  query: string;
  film: string | null;
  k: number;
}

export async function runSearch(
  env: Env,
  embeddings: Embeddings,
  published: Published,
  input: SearchInput,
): Promise<SearchReply> {
  const [vector, vectors, keyword] = await Promise.all([
    embedQuery(embeddings, input.query),
    loadVectors(env, published),
    keywordHits(env, input.query, input.film),
  ]);
  const lists: SignalHits[] = [
    {
      hits: vectors.store
        .rank(vector, rankOptions("frame", input.film))
        .slice(0, MAX_K),
      signal: "frame",
    },
    {
      hits: vectors.store
        .rank(vector, rankOptions("caption", input.film))
        .slice(0, MAX_K),
      signal: "caption",
    },
    { hits: keyword, signal: "bm25" },
  ];
  const results = await fuseToHits(env, lists, input.k);
  return { film: input.film, query: input.query, results };
}

export async function runSimilar(
  env: Env,
  published: Published,
  shotId: number,
  k: number,
): Promise<Hit[]> {
  const vectors = await loadVectors(env, published);
  const source = vectors.frames.get(shotId);
  if (source === undefined) return [];
  const sameShot = await sameShotIds(env, shotId);
  const ranked = vectors.store
    .rank(toQuery(source.values), {
      exclude: shotId,
      film: source.film,
      kind: "frame",
    })
    .filter((hit) => !sameShot.has(hit.shotId))
    .slice(0, MAX_K);
  return await fuseToHits(env, [{ signal: "frame", hits: ranked }], k);
}

async function sameShotIds(env: Env, shotId: number): Promise<Set<number>> {
  const { results } = await env.DB.prepare(SAME_SHOT_QUERY)
    .bind(shotId)
    .all<{ id: number }>();
  return new Set(results.map((row) => row.id));
}

function rankOptions(
  kind: "frame" | "caption",
  film: string | null,
): { kind: "frame" | "caption"; film?: string } {
  return film === null ? { kind } : { film, kind };
}

async function keywordHits(
  env: Env,
  query: string,
  film: string | null,
): Promise<RankedShot[]> {
  const match = ftsMatch(query);
  if (match === "") return [];
  const { results } =
    film === null
      ? await env.DB.prepare(KEYWORD_QUERY).bind(match, MAX_K).all<KeywordRow>()
      : await env.DB.prepare(KEYWORD_QUERY_FILM)
          .bind(match, film, MAX_K)
          .all<KeywordRow>();
  return results.map((row) => ({ score: -row.score, shotId: row.id }));
}

async function fuseToHits(
  env: Env,
  lists: SignalHits[],
  k: number,
): Promise<Hit[]> {
  const ids = new Set<number>();
  for (const list of lists) {
    for (const hit of list.hits) ids.add(hit.shotId);
  }
  const shots = await shotRows(env, [...ids]);
  const group = (shotId: number): string => {
    const shot = shots.get(shotId);
    return shot === undefined
      ? `row:${shotId}`
      : `${shot.film}@${shot.shotStart.toFixed(2)}-${shot.shotEnd.toFixed(2)}`;
  };
  const hits: Hit[] = [];
  for (const entry of fuse(lists, group, { limit: k })) {
    const shot = shots.get(entry.shotId);
    if (shot !== undefined) hits.push(toHit(shot, entry.score));
  }
  return hits;
}

async function shotRows(
  env: Env,
  ids: readonly number[],
): Promise<Map<number, ShotRow>> {
  const shots = new Map<number, ShotRow>();
  for (let at = 0; at < ids.length; at += D1_PARAMETER_LIMIT) {
    const chunk = ids.slice(at, at + D1_PARAMETER_LIMIT);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await env.DB.prepare(
      `SELECT s.id, s.film, s.idx, s.time, s.shot_start AS shotStart, s.shot_end AS shotEnd, s.caption, s.tags, f.title FROM shots s JOIN films f ON f.slug = s.film WHERE s.id IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<ShotRow>();
    for (const row of results) shots.set(row.id, row);
  }
  return shots;
}

function toHit(shot: ShotRow, score: number): Hit {
  return {
    caption: shot.caption,
    film: shot.film,
    frameUrl: `/${frameKey(shot.film, shot.idx)}`,
    score,
    shotEnd: shot.shotEnd,
    shotId: shot.id,
    shotStart: shot.shotStart,
    tags: tagsOf(shot.tags),
    time: shot.time,
    title: shot.title,
  };
}

function tagsOf(raw: string | null): string[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed)
    ? parsed.filter((tag): tag is string => typeof tag === "string")
    : [];
}

function toQuery(values: Int8Array): Float32Array {
  const query = new Float32Array(values.length);
  for (let at = 0; at < values.length; at += 1) query[at] = values[at] ?? 0;
  return query;
}
