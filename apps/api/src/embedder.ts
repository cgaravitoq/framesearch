import { Container } from "@cloudflare/containers";
import { busyReply, CONTAINER_MS_HEADER } from "./embedder-routing.ts";
import type { Env } from "./env.ts";

const HEALTH_URL = "http://localhost/health";
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

export class EmbedderContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "1h";
  override enableInternet = false;
  override pingEndpoint = "health";

  private pending = 0;

  override async fetch(request: Request): Promise<Response> {
    if (this.pending > 0) return busyReply();
    this.pending += 1;
    const started = Date.now();
    try {
      const reply = await super.fetch(request);
      const headers = new Headers(reply.headers);
      headers.set(CONTAINER_MS_HEADER, String(Date.now() - started));
      return new Response(reply.body, {
        headers,
        status: reply.status,
        statusText: reply.statusText,
      });
    } finally {
      this.pending -= 1;
    }
  }

  override async onStart(): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const response = await this.containerFetch(HEALTH_URL);
      if (response.ok) return;
      await new Promise((settle) => setTimeout(settle, POLL_INTERVAL_MS));
    }
    throw new Error(
      `the embedder did not load its model within ${READY_TIMEOUT_MS} ms`,
    );
  }
}
