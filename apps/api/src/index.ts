import { createApp } from "./app.ts";
import type { Env } from "./env.ts";

const app = createApp();

export default {
  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};
