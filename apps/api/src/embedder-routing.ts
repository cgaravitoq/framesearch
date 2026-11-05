import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type { EmbedderContainer } from "./embedder.ts";

export const EMBEDDER_INSTANCES = [
  "primary",
  "overflow-1",
  "overflow-2",
] as const;

export const BUSY_HEADER = "x-embedder-busy";
export const BUSY_STATUS = 503;
export const CONTAINER_MS_HEADER = "x-embedder-ms";

const EMBEDDINGS_URL = "http://embedder/v1/embeddings";
const RETRY_STATUSES: ReadonlySet<number> = new Set([500, 502]);
const WAIT_BUDGET_MS = 15_000;
const WAIT_INTERVAL_MS = 100;

export interface EmbedderReply {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export interface EmbedTrace {
  attempts: string[];
  busy: number;
  containerMs: number;
  ms: number;
}

export function busyReply(): Response {
  return new Response("the embedder instance is busy", {
    headers: { [BUSY_HEADER]: "1", "content-type": "text/plain" },
    status: BUSY_STATUS,
  });
}

export function isBusy(reply: EmbedderReply): boolean {
  return reply.status === BUSY_STATUS;
}

export async function postEmbeddings(
  namespace: DurableObjectNamespace<EmbedderContainer>,
  input: readonly string[],
  trace?: EmbedTrace,
): Promise<EmbedderReply> {
  let retries = 1;
  const last = EMBEDDER_INSTANCES.length - 1;
  for (const [index, name] of EMBEDDER_INSTANCES.entries()) {
    trace?.attempts.push(name);
    let reply: EmbedderReply;
    try {
      reply = await postTo(namespace, name, input);
    } catch (error) {
      if (retries === 0 || index === last) throw error;
      retries -= 1;
      continue;
    }
    addContainerMs(trace, reply);
    if (isBusy(reply)) {
      if (trace !== undefined) trace.busy += 1;
      continue;
    }
    if (RETRY_STATUSES.has(reply.status) && retries > 0 && index < last) {
      retries -= 1;
      continue;
    }
    return reply;
  }
  return await waitForPrimary(namespace, input, trace);
}

export function warmPrimary(
  namespace: DurableObjectNamespace<EmbedderContainer>,
  input: readonly string[],
): Promise<EmbedderReply> {
  return postTo(namespace, EMBEDDER_INSTANCES[0], input);
}

async function waitForPrimary(
  namespace: DurableObjectNamespace<EmbedderContainer>,
  input: readonly string[],
  trace?: EmbedTrace,
): Promise<EmbedderReply> {
  const deadline = Date.now() + WAIT_BUDGET_MS;
  await sleep(WAIT_INTERVAL_MS);
  let reply = await pollPrimary(namespace, input, trace);
  while (isBusy(reply) && Date.now() < deadline) {
    await sleep(WAIT_INTERVAL_MS);
    reply = await pollPrimary(namespace, input, trace);
  }
  return reply;
}

async function pollPrimary(
  namespace: DurableObjectNamespace<EmbedderContainer>,
  input: readonly string[],
  trace: EmbedTrace | undefined,
): Promise<EmbedderReply> {
  trace?.attempts.push(EMBEDDER_INSTANCES[0]);
  const reply = await postTo(namespace, EMBEDDER_INSTANCES[0], input);
  addContainerMs(trace, reply);
  if (trace !== undefined && isBusy(reply)) trace.busy += 1;
  return reply;
}

function addContainerMs(
  trace: EmbedTrace | undefined,
  reply: EmbedderReply,
): void {
  if (trace === undefined) return;
  const raw = reply.headers.get(CONTAINER_MS_HEADER);
  if (raw === null) return;
  const ms = Number(raw);
  if (Number.isFinite(ms)) trace.containerMs += ms;
}

function postTo(
  namespace: DurableObjectNamespace<EmbedderContainer>,
  name: string,
  input: readonly string[],
): Promise<EmbedderReply> {
  return namespace.getByName(name).fetch(EMBEDDINGS_URL, {
    body: JSON.stringify({ input }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((settle) => setTimeout(settle, ms));
}
