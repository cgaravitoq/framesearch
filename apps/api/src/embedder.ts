import { Container } from "@cloudflare/containers";
import { busyReply, CONTAINER_MS_HEADER } from "./embedder-routing.ts";
import type { Env } from "./env.ts";

const HEALTH_URL = "http://localhost/health";
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;
const IDLE_CAP_MS = 30 * 60_000;
const IDLE_CHECK_SECONDS = 5 * 60;
const IDLE_CAP_KEY = "idle-cap-armed";

export class EmbedderContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "10m";
  override enableInternet = false;
  override pingEndpoint = "health";

  private pending = 0;
  private ready = false;
  private lastRequestAt = Date.now();

  // The base class counts a request in flight until its proxied body is fully
  // read, and never sleeps while one is in flight; reading the body here keeps a
  // caller that drops it (the prewarm) from holding the container awake forever.
  override async fetch(request: Request): Promise<Response> {
    if (this.ready && this.pending > 0) return busyReply();
    this.pending += 1;
    this.lastRequestAt = Date.now();
    const started = this.lastRequestAt;
    try {
      const reply = await super.fetch(request);
      const body = await reply.arrayBuffer();
      const headers = new Headers(reply.headers);
      headers.set(CONTAINER_MS_HEADER, String(Date.now() - started));
      return new Response(body, {
        headers,
        status: reply.status,
        statusText: reply.statusText,
      });
    } finally {
      this.pending -= 1;
      this.lastRequestAt = Date.now();
    }
  }

  override async onStart(): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const response = await this.containerFetch(HEALTH_URL);
      if (response.ok) {
        this.ready = true;
        await this.armIdleCap();
        return;
      }
      await new Promise((settle) => setTimeout(settle, POLL_INTERVAL_MS));
    }
    throw new Error(
      `the embedder did not load its model within ${READY_TIMEOUT_MS} ms`,
    );
  }

  override onStop(): void {
    this.ready = false;
  }

  // A backstop owned by this class rather than the library: if anything ever
  // again keeps the base class from honouring sleepAfter (a leaked in-flight
  // count, a timer renewed on every wake), the container still stops once no
  // request has arrived for IDLE_CAP_MS. The stored flag keeps one pending
  // check per instance across restarts, since schedules cannot be cancelled.
  async enforceIdleCap(): Promise<void> {
    await this.ctx.storage.delete(IDLE_CAP_KEY);
    if (!this.ctx.container?.running) return;
    if (Date.now() - this.lastRequestAt < IDLE_CAP_MS) {
      await this.armIdleCap();
      return;
    }
    console.warn(
      `stopping the embedder after ${IDLE_CAP_MS / 60_000} min without a request`,
    );
    await this.stop();
  }

  private async armIdleCap(): Promise<void> {
    if (await this.ctx.storage.get(IDLE_CAP_KEY)) return;
    await this.ctx.storage.put(IDLE_CAP_KEY, true);
    await this.schedule(IDLE_CHECK_SECONDS, "enforceIdleCap");
  }
}
