export const DEFAULT_K = 24;
export const MAX_K = 60;
export const MAX_QUERY_LENGTH = 500;

const CANONICAL_POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const FILM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_FILM_SLUG_LENGTH = 100;

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseQuery(raw: string | null): Validated<string> {
  const value = (raw ?? "").trim();
  if (value === "") return { ok: false, error: "q is empty" };
  if (value.length > MAX_QUERY_LENGTH) {
    return {
      ok: false,
      error: `q must be at most ${MAX_QUERY_LENGTH} characters`,
    };
  }
  return { ok: true, value };
}

export function parseK(raw: string | null): Validated<number> {
  if (raw === null || raw === "") return { ok: true, value: DEFAULT_K };
  const value = positiveInteger(raw);
  if (value === null || value > MAX_K) {
    return { ok: false, error: `k must be an integer from 1 to ${MAX_K}` };
  }
  return { ok: true, value };
}

export function parseShotId(raw: string): Validated<number> {
  const value = positiveInteger(raw);
  if (value === null) {
    return { ok: false, error: "id must be a positive integer" };
  }
  return { ok: true, value };
}

export function parseFilmSlug(raw: string): Validated<string> {
  if (raw.length > MAX_FILM_SLUG_LENGTH || !FILM_SLUG.test(raw)) {
    return { ok: false, error: "film must be a lowercase slug" };
  }
  return { ok: true, value: raw };
}

function positiveInteger(raw: string): number | null {
  if (!CANONICAL_POSITIVE_INTEGER.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
