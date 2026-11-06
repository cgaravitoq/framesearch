import type {
  ClickLogReply,
  ClickLogRequest,
  Film,
  FilmsReply,
  FlagsReply,
  Hit,
  SearchLogReply,
  SearchReply,
  SimilarReply,
} from "@framesearch/schema";

export class ApiError extends Error {
  readonly status: number;
  readonly busy: boolean;

  constructor(message: string, status: number, busy: boolean) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.busy = busy;
  }
}

const WAKE_RETRIES = 10;
export const WAKE_RETRY_MS = 2000;

interface Reply<T> {
  body: T;
  serverMs: number | null;
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<Reply<T>> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError(
      "The search service could not be reached. Check your connection and retry.",
      0,
      false,
    );
  }
  const body = await readJson(response);
  if (!response.ok) throw failure(response, body);
  return {
    body: body as T,
    serverMs: serverTotal(response.headers.get("server-timing")),
  };
}

function failure(response: Response, body: unknown): ApiError {
  const { status } = response;
  if (status === 429) {
    return new ApiError(
      "Too many searches from this address. Retry in a minute.",
      status,
      true,
    );
  }
  if (status === 503 && response.headers.get("retry-after") !== null) {
    return new ApiError(
      "The search model is waking up. Retry in a few seconds.",
      status,
      true,
    );
  }
  return new ApiError(
    errorMessage(body) ?? `The search service answered ${status}.`,
    status,
    false,
  );
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

export function serverTotal(header: string | null): number | null {
  const match = /(?:^|,)\s*total;dur=([\d.]+)/.exec(header ?? "");
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function retryWhileWaking(failures: number, error: Error): boolean {
  return (
    error instanceof ApiError &&
    error.status === 503 &&
    error.busy &&
    failures < WAKE_RETRIES
  );
}

export function prewarmEmbedder(): void {
  void fetch("/api/prewarm").catch(() => undefined);
}

export async function getFilms(signal: AbortSignal): Promise<Film[]> {
  const reply = await getJson<FilmsReply>("/api/films", signal);
  return reply.body.films;
}

export async function getFlags(signal: AbortSignal): Promise<FlagsReply> {
  const reply = await getJson<FlagsReply>("/api/flags", signal);
  return reply.body;
}

export interface Found {
  reply: SearchReply;
  serverMs: number | null;
}

export async function searchShots(
  term: string,
  k: number,
  signal: AbortSignal,
): Promise<Found> {
  const params = new URLSearchParams({ q: term, k: String(k) });
  const { body, serverMs } = await getJson<SearchReply>(
    `/api/search?${params.toString()}`,
    signal,
  );
  return { reply: body, serverMs };
}

export async function similarShots(
  shot: Hit,
  k: number,
  signal: AbortSignal,
): Promise<Hit[]> {
  const params = new URLSearchParams({
    id: String(shot.shotId),
    k: String(k + 1),
  });
  const { body } = await getJson<SimilarReply>(
    `/api/similar?${params.toString()}`,
    signal,
  );
  return body.results
    .filter((entry) => entry.shotId !== shot.shotId)
    .slice(0, k);
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
