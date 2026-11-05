import type { Hit } from "@framesearch/schema";

const MAX_ENTRIES = 200;
const TTL_MS = 10 * 60 * 1000;
const WHITESPACE = /\s+/g;

interface Entry {
  at: number;
  signature: string;
  results: Hit[];
}

const entries = new Map<string, Entry>();

export function cacheKey(
  query: string,
  film: string | null,
  k: number,
): string {
  const normalized = query.trim().toLowerCase().replace(WHITESPACE, " ");
  return `${normalized}\u0000${film ?? ""}\u0000${k}`;
}

export function readCache(
  key: string,
  signature: string,
  now = Date.now(),
): Hit[] | null {
  const entry = entries.get(key);
  if (entry === undefined) return null;
  if (entry.signature !== signature || now - entry.at > TTL_MS) {
    entries.delete(key);
    return null;
  }
  return entry.results;
}

export function writeCache(
  key: string,
  signature: string,
  results: Hit[],
  now = Date.now(),
): void {
  entries.delete(key);
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }
  entries.set(key, { at: now, results, signature });
}
