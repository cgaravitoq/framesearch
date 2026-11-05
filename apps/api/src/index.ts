import { createApp } from "./app.ts";
import { EmbedderContainer } from "./embedder.ts";
import { prewarmEmbeddings } from "./embeddings.ts";
import type { Env } from "./env.ts";

export { EmbedderContainer };

const app = createApp();

app.get("/api/prewarm", async (c) => {
  const address = c.req.header("cf-connecting-ip") ?? "local";
  const prewarm = await prewarmEmbeddings(c.env, address);
  if (prewarm === "limited") {
    return c.json({ error: "too many prewarms from this address" }, 429, {
      "cache-control": "no-store",
      "retry-after": "60",
    });
  }
  return c.json({ warm: prewarm === "warm" }, 200, {
    "cache-control": "no-store",
  });
});

export default {
  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};
