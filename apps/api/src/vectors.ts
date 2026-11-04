import { createVectorStore, type FilmVectorSet } from "@framesearch/core";
import {
  decodeVectors,
  type VectorStore,
  vectorsKey,
} from "@framesearch/schema";
import type { Env } from "./env.ts";

export interface Published {
  slugs: readonly string[];
  signature: string;
}

export interface LoadedVectors {
  signature: string;
  store: VectorStore;
  frames: Map<number, { film: string; values: Int8Array }>;
}

export async function publishedFilms(env: Env): Promise<Published> {
  const { results } = await env.DB.prepare(
    "SELECT slug FROM films ORDER BY slug",
  ).all<{ slug: string }>();
  const slugs = results.map((row) => row.slug);
  return { slugs, signature: slugs.join(",") };
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

export function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    value = Math.imul(value ^ text.charCodeAt(at), 0x01000193);
  }
  return (value >>> 0).toString(36);
}

async function readFilms(
  env: Env,
  published: Published,
): Promise<LoadedVectors> {
  const sets: FilmVectorSet[] = [];
  const frames = new Map<number, { film: string; values: Int8Array }>();
  for (const film of published.slugs) {
    const object = await env.FRAMES.get(vectorsKey(film));
    if (object === null) continue;
    const vectors = decodeVectors(await object.arrayBuffer());
    sets.push({ film, vectors });
    for (const record of vectors.frames) {
      frames.set(record.shotId, { film, values: record.values });
    }
  }
  return {
    signature: published.signature,
    store: createVectorStore(sets),
    frames,
  };
}
