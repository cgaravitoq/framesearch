import { createVectorStore, type FilmVectorSet } from "@framesearch/core";
import {
  decodeVectors,
  type VectorStore,
  vectorsKey,
} from "@framesearch/schema";
import type { Env } from "./env.ts";

export interface PublishedFilm {
  slug: string;
  version: number;
  uploaded: number;
}

export interface Published {
  films: readonly PublishedFilm[];
  signature: string;
}

export interface LoadedVectors {
  signature: string;
  store: VectorStore;
  films: ReadonlyMap<number, string>;
}

const PUBLISHED_QUERY =
  "SELECT f.slug AS slug, COALESCE(MAX(s.id), 0) AS version FROM films f LEFT JOIN shots s ON s.film = f.slug GROUP BY f.slug ORDER BY f.slug";

export async function publishedFilms(env: Env): Promise<Published> {
  const { results } = await env.DB.prepare(PUBLISHED_QUERY).all<{
    slug: string;
    version: number;
  }>();
  const films = await Promise.all(
    results.map(async (row) => ({
      slug: row.slug,
      uploaded: await vectorsUploaded(env, row.slug),
      version: row.version,
    })),
  );
  return { films, signature: signatureOf(films) };
}

async function vectorsUploaded(env: Env, slug: string): Promise<number> {
  const head = await env.FRAMES.head(vectorsKey(slug));
  return head?.uploaded.getTime() ?? 0;
}

function signatureOf(films: readonly PublishedFilm[]): string {
  return films
    .map((film) => `${film.slug}@${film.version}.${film.uploaded}`)
    .join(",");
}

let loaded: LoadedVectors | null = null;
let loading: { signature: string; promise: Promise<LoadedVectors> } | null =
  null;

export async function loadVectors(
  env: Env,
  published: Published,
): Promise<LoadedVectors> {
  if (loaded !== null && loaded.signature === published.signature) {
    return loaded;
  }
  if (loading !== null && loading.signature === published.signature) {
    return await loading.promise;
  }
  const promise = readFilms(env, published);
  loading = { signature: published.signature, promise };
  try {
    loaded = await promise;
    return loaded;
  } finally {
    if (loading !== null && loading.promise === promise) loading = null;
  }
}

async function readFilms(
  env: Env,
  published: Published,
): Promise<LoadedVectors> {
  const sets: FilmVectorSet[] = [];
  const films = new Map<number, string>();
  for (const film of published.films) {
    const object = await env.FRAMES.get(vectorsKey(film.slug));
    if (object === null) continue;
    const vectors = decodeVectors(await object.arrayBuffer());
    sets.push({ film: film.slug, vectors });
    for (const record of vectors.frames) films.set(record.shotId, film.slug);
  }
  return {
    signature: published.signature,
    store: createVectorStore(sets),
    films,
  };
}
