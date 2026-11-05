import { MAX_QUERY_LENGTH, parseFilmSlug } from "@framesearch/core";
import type { ClickLogReply, SearchLogReply } from "@framesearch/schema";
import type { Env } from "./env.ts";

const MAX_BODY_BYTES = 8192;
const MAX_LOGGED_SHOTS = 200;

export type LogResult<T> =
  | { ok: true; body: T }
  | { ok: false; status: number; error: string };

export async function logSearch(
  env: Env,
  request: Request,
): Promise<LogResult<SearchLogReply>> {
  const read = await readJson(request);
  if (!read.ok) return read;
  const query =
    typeof read.body.query === "string" ? read.body.query.trim() : "";
  if (query === "" || query.length > MAX_QUERY_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `query must be one to ${MAX_QUERY_LENGTH} characters`,
    };
  }
  let film: string | null = null;
  const rawFilm = read.body.film ?? null;
  if (rawFilm !== null) {
    const parsed = parseFilmSlug(
      typeof rawFilm === "string" ? rawFilm.trim() : "",
    );
    if (!parsed.ok) {
      return {
        ok: false,
        status: 400,
        error: "film must be a film slug or null",
      };
    }
    film = parsed.value;
  }
  const shotIds = readShotIds(read.body.shotIds);
  if (shotIds === null) {
    return {
      ok: false,
      status: 400,
      error: `shotIds must be at most ${MAX_LOGGED_SHOTS} positive integers`,
    };
  }
  try {
    const { meta } = await env.DB.prepare(
      "INSERT INTO search_log (query, film, shot_ids, created_at) VALUES (?1, ?2, ?3, ?4)",
    )
      .bind(query, film, JSON.stringify(shotIds), Date.now())
      .run();
    return { ok: true, body: { id: meta.last_row_id, logged: true } };
  } catch {
    return { ok: true, body: { id: null, logged: false } };
  }
}

export async function logClick(
  env: Env,
  request: Request,
): Promise<LogResult<ClickLogReply>> {
  const read = await readJson(request);
  if (!read.ok) return read;
  const searchId = positiveInteger(read.body.searchId);
  if (searchId === null) {
    return {
      ok: false,
      status: 400,
      error: "searchId must be a positive integer",
    };
  }
  const shotId = positiveInteger(read.body.shotId);
  if (shotId === null) {
    return {
      ok: false,
      status: 400,
      error: "shotId must be a positive integer",
    };
  }
  const declaredRank = read.body.rank ?? null;
  const givenRank =
    declaredRank === null ? null : positiveInteger(declaredRank);
  if (declaredRank !== null && givenRank === null) {
    return {
      ok: false,
      status: 400,
      error: "rank must be a positive integer or null",
    };
  }
  try {
    const rank = givenRank ?? (await storedRank(env, searchId, shotId));
    await env.DB.prepare(
      "INSERT INTO search_click (search_id, shot_id, rank, created_at) VALUES (?1, ?2, ?3, ?4)",
    )
      .bind(searchId, shotId, rank, Date.now())
      .run();
    return { ok: true, body: { id: null, logged: true, rank } };
  } catch {
    return { ok: true, body: { id: null, logged: false, rank: null } };
  }
}

async function storedRank(
  env: Env,
  searchId: number,
  shotId: number,
): Promise<number | null> {
  const row = await env.DB.prepare(
    "SELECT shot_ids FROM search_log WHERE id = ?1",
  )
    .bind(searchId)
    .first<{ shot_ids: string }>();
  return rankOf(row?.shot_ids ?? null, shotId);
}

interface Failure {
  ok: false;
  status: number;
  error: string;
}

type ReadResult = { ok: true; body: Record<string, unknown> } | Failure;

type TextResult = { ok: true; text: string } | Failure;

const UTF8 = new TextDecoder();

async function readJson(request: Request): Promise<ReadResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    return {
      ok: false,
      status: 415,
      error: "the log routes take application/json only",
    };
  }
  const body = await readText(request);
  if (!body.ok) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return { ok: false, status: 400, error: "the body must be a JSON object" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: "the body must be a JSON object" };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

async function readText(request: Request): Promise<TextResult> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return tooLarge();
  const stream = request.body;
  if (stream === null) return { ok: true, text: "" };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { ok: true, text: UTF8.decode(bytes) };
}

function tooLarge(): Failure {
  return {
    ok: false,
    status: 413,
    error: `the log body must be at most ${MAX_BODY_BYTES} bytes`,
  };
}

function readShotIds(value: unknown): number[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LOGGED_SHOTS) return null;
  const ids: number[] = [];
  for (const item of value) {
    const id = positiveInteger(item);
    if (id === null) return null;
    ids.push(id);
  }
  return ids;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function rankOf(raw: string | null, shotId: number): number | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const at = parsed.indexOf(shotId);
    return at < 0 ? null : at + 1;
  } catch {
    return null;
  }
}
