import type { Film } from "@framesearch/schema";
import { Hono } from "hono";
import type { Env } from "./env.ts";

export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/films", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT slug, title, duration FROM films ORDER BY title",
    ).all<Film>();
    return json({ films: results });
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
