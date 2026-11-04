import {
  parseFilmSlug,
  parseK,
  parseQuery,
  parseShotId,
} from "@framesearch/core";
import type { Film, SearchReply } from "@framesearch/schema";
import { frameKey } from "@framesearch/schema";
import { type Context, Hono } from "hono";
import { embeddingsConfig } from "./embeddings.ts";
import type { Env } from "./env.ts";
import { runSearch, runSimilar } from "./search.ts";
import { hash, publishedFilms } from "./vectors.ts";

const FRAME_SUFFIX = ".jpg";
const IMMUTABLE_FRAME_CACHE = "public, max-age=31536000, immutable";
const SEARCH_CACHE_SECONDS = 3600;
const MISSING_EMBEDDINGS =
  "search is unavailable: EMBED_URL, EMBED_API_KEY and EMBED_MODEL are not set";

export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/films", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT slug, title, duration FROM films ORDER BY title",
    ).all<Film>();
    return json({ films: results });
  });

  app.get("/frames/:film/:frame", async (c) => {
    const film = parseFilmSlug(c.req.param("film"));
    if (!film.ok) return failure(film.error, 400);
    const name = c.req.param("frame");
    if (!name.endsWith(FRAME_SUFFIX)) {
      return failure(`no frame for ${c.req.path}`, 404);
    }
    const idx = parseShotId(name.slice(0, -FRAME_SUFFIX.length));
    if (!idx.ok) return failure(idx.error, 400);
    const object = await c.env.FRAMES.get(frameKey(film.value, idx.value));
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
    if (embeddings === null) return failure(MISSING_EMBEDDINGS, 503);
    const published = await publishedFilms(c.env);
    const cache = caches.default;
    const key = cacheKey(c.req.url, published.signature);
    const cached = await cache.match(key);
    if (cached !== undefined) return tagged(cached);
    let reply: SearchReply;
    try {
      reply = await runSearch(c.env, embeddings, published, {
        film: film.value,
        k: k.value,
        query: query.value,
      });
    } catch (error) {
      return failure(message(error), 502);
    }
    const response = json(reply, 200, {
      "cache-control": `public, max-age=${SEARCH_CACHE_SECONDS}`,
      "x-cache": "miss",
    });
    c.executionCtx.waitUntil(cache.put(key, response.clone()));
    return response;
  });

  app.get("/api/similar", async (c) => {
    const limited = await rateLimited(c);
    if (limited !== null) return limited;
    const id = parseShotId(c.req.query("id") ?? "");
    if (!id.ok) return failure(id.error, 400);
    const k = parseK(c.req.query("k") ?? null);
    if (!k.ok) return failure(k.error, 400);
    const published = await publishedFilms(c.env);
    try {
      return json({
        results: await runSimilar(c.env, published, id.value, k.value),
        shotId: id.value,
      });
    } catch (error) {
      return failure(message(error), 502);
    }
  });

  app.notFound((c) => failure(`no route for ${c.req.path}`, 404));
  app.onError((error) => failure(message(error), 500));
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
  return json({ error }, status, headers);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function cacheKey(url: string, signature: string): string {
  const key = new URL(url);
  key.searchParams.set("v", hash(signature));
  return key.toString();
}

function tagged(response: Response): Response {
  const replay = new Response(response.body, response);
  replay.headers.set("x-cache", "hit");
  return replay;
}

type FilmChoice =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

function filmParam(raw: string | null): FilmChoice {
  if (raw === null || raw.trim() === "") return { ok: true, value: null };
  const film = parseFilmSlug(raw.trim());
  return film.ok ? { ok: true, value: film.value } : film;
}
