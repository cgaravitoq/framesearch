import { createApp } from "./app.ts";
import { EmbedderContainer } from "./embedder.ts";
import { prewarmEmbeddings } from "./embeddings.ts";
import type { Env } from "./env.ts";

export { EmbedderContainer };

const app = createApp();

app.get("/api/prewarm", async (c) =>
  c.json({ warm: await prewarmEmbeddings(c.env) }, 200, {
    "cache-control": "no-store",
  }),
);

export default {
  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};
