import type {
  ClickLogReply,
  ClickLogRequest,
  Film,
  FilmsReply,
  FlagsReply,
  SearchLogReply,
  SearchReply,
  SimilarReply,
} from "@framesearch/schema";

const SEARCH_K = 24;
const SIMILAR_K = 12;

export class ApiError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ApiError";
    this.retryable = retryable;
  }
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      errorMessage(body) ?? `the server answered ${response.status}`,
      response.headers.get("retry-after") !== null,
    );
  }
  return body as T;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

function errorMessage(body: unknown): string | null {
  if (typeof body === "object" && body !== null && "error" in body) {
    const value = (body as { error: unknown }).error;
    if (typeof value === "string") return value;
  }
  return null;
}

export function prewarmEmbedder(): void {
  void fetch("/api/prewarm").catch(() => undefined);
}

export async function getFilms(signal: AbortSignal): Promise<Film[]> {
  const reply = await getJson<FilmsReply>("/api/films", signal);
  return reply.films;
}

export async function getFlags(signal: AbortSignal): Promise<FlagsReply> {
  return getJson<FlagsReply>("/api/flags", signal);
}

export async function searchShots(
  term: string,
  film: string,
  signal: AbortSignal,
): Promise<SearchReply> {
  const params = new URLSearchParams({ q: term, k: String(SEARCH_K) });
  if (film !== "") params.set("film", film);
  return getJson<SearchReply>(`/api/search?${params.toString()}`, signal);
}

export async function similarShots(
  shotId: number,
  signal: AbortSignal,
): Promise<SimilarReply> {
  const params = new URLSearchParams({
    id: String(shotId),
    k: String(SIMILAR_K),
  });
  return getJson<SimilarReply>(`/api/similar?${params.toString()}`, signal);
}

export async function logSearch(reply: SearchReply): Promise<number | null> {
  const logged = await postJson<SearchLogReply>("/api/log/search", {
    film: reply.film,
    query: reply.query,
    shotIds: reply.results.map((shot) => shot.shotId),
  });
  return logged?.id ?? null;
}

export async function logClick(
  searchId: number,
  shotId: number,
  rank: number | null,
): Promise<void> {
  const body: ClickLogRequest = { rank, searchId, shotId };
  await postJson<ClickLogReply>("/api/log/click", body);
}

async function postJson<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
