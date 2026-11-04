import { parseFilmSlug, parseShotId } from "@framesearch/core";
import type { Film } from "@framesearch/schema";
import { frameKey } from "@framesearch/schema";
import { Hono } from "hono";
import type { Env } from "./env.ts";

const FRAME_SUFFIX = ".jpg";
const IMMUTABLE_FRAME_CACHE = "public, max-age=31536000, immutable";

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
