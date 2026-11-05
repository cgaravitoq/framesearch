import {
  parseFilmSlug,
  parseK,
  parseQuery,
  parseShotId,
} from "@framesearch/core";
import type {
  ErrorReply,
  Film,
  FilmsReply,
  FlagsReply,
  Hit,
  SearchReply,
  SimilarReply,
} from "@framesearch/schema";
import { frameKey } from "@framesearch/schema";
import { type Context, Hono } from "hono";
import { cacheKey, readCache, writeCache } from "./cache.ts";
import { EmbedderBusy, embeddingsConfig } from "./embeddings.ts";
import type { Env } from "./env.ts";
import { readFlags } from "./flags.ts";
import { logClick, logSearch } from "./log.ts";
import { runSearch, runSimilar } from "./search.ts";
import { publishedFilms } from "./vectors.ts";

const FRAME_SUFFIX = ".jpg";
const FRAME_INDEX = /^(?:0|[1-9][0-9]{0,8})$/;
const IMMUTABLE_FRAME_CACHE = "public, max-age=31536000, immutable";
const SEARCH_CACHE_SECONDS = 60;
const UNAVAILABLE = "Search is temporarily unavailable";
const BUSY = "Search is busy, try again in a moment";
const BUSY_RETRY_AFTER_SECONDS = "2";
const SERVER_ERROR = "Something went wrong";
const MISSING_EMBEDDINGS =
  "search is unavailable: neither EMBED_URL with EMBED_API_KEY and EMBED_MODEL nor the EMBEDDER container is configured";

export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/flags", (c) => {
    const reply: FlagsReply = readFlags(c.env);
    return json(reply);
  });

  app.get("/api/films", async (c) => {
    const db = c.env.DB.withSession();
    const { results } = await db
      .prepare("SELECT slug, title, duration FROM films ORDER BY title")
      .all<Film>();
    const reply: FilmsReply = { films: results };
    return json(reply);
  });

  app.get("/frames/:film/:frame", async (c) => {
    const film = parseFilmSlug(c.req.param("film"));
    if (!film.ok) return failure(film.error, 400);
    const name = c.req.param("frame");
    if (!name.endsWith(FRAME_SUFFIX)) {
      return failure(`no frame for ${c.req.path}`, 404);
    }
    const idx = name.slice(0, -FRAME_SUFFIX.length);
    if (!FRAME_INDEX.test(idx)) {
      return failure("frame index must be a non-negative integer", 400);
    }
    const object = await c.env.FRAMES.get(frameKey(film.value, Number(idx)));
    if (object === null) return failure("frame not found", 404);
    return new Response(object.body, {
      headers: {
        "cache-control": IMMUTABLE_FRAME_CACHE,
        "content-type": "image/jpeg",
        etag: object.httpEtag,
      },
    });
  });

  app.get("/api/search", async (c) => {
    const limited = await rateLimited(c);
    if (limited !== null) return limited;
    const query = parseQuery(c.req.query("q") ?? null);
    if (!query.ok) return failure(query.error, 400);
    const film = filmParam(c.req.query("film") ?? null);
    if (!film.ok) return failure(film.error, 400);
    const k = parseK(c.req.query("k") ?? null);
    if (!k.ok) return failure(k.error, 400);
    const embeddings = embeddingsConfig(c.env);
    if (embeddings === null) {
      console.error(MISSING_EMBEDDINGS);
      return failure(UNAVAILABLE, 503);
    }
    const db = c.env.DB.withSession();
    const published = await publishedFilms(db);
    const key = cacheKey(query.value, film.value, k.value);
    const cached = readCache(key, published.signature);
    if (cached !== null) {
      return searchReply(cached, query.value, film.value, "hit");
    }
    let results: Hit[];
    try {
      results = (
        await runSearch(c.env, db, embeddings, published, {
          film: film.value,
          k: k.value,
          query: query.value,
        })
      ).results;
    } catch (error) {
      if (error instanceof EmbedderBusy) {
        return failure(BUSY, 503, { "retry-after": BUSY_RETRY_AFTER_SECONDS });
      }
      console.error("search failed", error);
      return failure(UNAVAILABLE, 502);
    }
    writeCache(key, published.signature, results);
    return searchReply(results, query.value, film.value, "miss");
  });

  app.get("/api/similar", async (c) => {
    const limited = await rateLimited(c);
    if (limited !== null) return limited;
    const id = parseShotId(c.req.query("id") ?? "");
    if (!id.ok) return failure(id.error, 400);
    const k = parseK(c.req.query("k") ?? null);
    if (!k.ok) return failure(k.error, 400);
    const db = c.env.DB.withSession();
    const published = await publishedFilms(db);
    try {
      const results = await runSimilar(c.env, db, published, id.value, k.value);
      const reply: SimilarReply = { results, shotId: id.value };
      return json(reply);
    } catch (error) {
      console.error("similar failed", error);
      return failure(SERVER_ERROR, 502);
    }
  });

  app.post("/api/log/search", async (c) => {
    if (!readFlags(c.env).searchLog) return loggingOff();
    const result = await logSearch(c.env, c.req.raw);
    return result.ok ? json(result.body) : failure(result.error, result.status);
  });

  app.post("/api/log/click", async (c) => {
    if (!readFlags(c.env).searchLog) return loggingOff();
    const result = await logClick(c.env, c.req.raw);
    return result.ok ? json(result.body) : failure(result.error, result.status);
  });

  app.notFound((c) => failure(`no route for ${c.req.path}`, 404));
  app.onError((error) => {
    console.error("unhandled error", error);
    return failure(SERVER_ERROR, 500);
  });
  return app;
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function failure(
  error: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  const reply: ErrorReply = { error };
  return json(reply, status, headers);
}

function loggingOff(): Response {
  return failure("search logging is off", 404);
}

async function rateLimited(
  c: Context<{ Bindings: Env }>,
): Promise<Response | null> {
  const address = c.req.header("cf-connecting-ip") ?? "local";
  const { success } = await c.env.SEARCH_RATE_LIMIT.limit({
    key: `search:${address}`,
  });
  if (success) return null;
  return failure(
    "too many searches from this address, retry in a minute",
    429,
    { "retry-after": "60" },
  );
}

function searchReply(
  results: Hit[],
  query: string,
  film: string | null,
  cache: "hit" | "miss",
): Response {
  const reply: SearchReply = { film, query, results };
  return json(reply, 200, {
    "cache-control": `public, max-age=${SEARCH_CACHE_SECONDS}`,
    "x-cache": cache,
  });
}

type FilmChoice =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

function filmParam(raw: string | null): FilmChoice {
  if (raw === null || raw.trim() === "") return { ok: true, value: null };
  const film = parseFilmSlug(raw.trim());
  return film.ok ? { ok: true, value: film.value } : film;
}
