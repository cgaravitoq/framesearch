import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type { EmbedderContainer } from "./embedder.ts";

export const EMBEDDER_INSTANCES = [
  "primary",
  "overflow-1",
  "overflow-2",
] as const;

const EMBEDDINGS_URL = "http://embedder/v1/embeddings";
const inFlight = new Map<string, number>();

export interface EmbedderReply {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export function idleInstance(counts: ReadonlyMap<string, number>): string {
  let chosen: string = EMBEDDER_INSTANCES[0];
  for (const name of EMBEDDER_INSTANCES) {
    if ((counts.get(name) ?? 0) < (counts.get(chosen) ?? 0)) chosen = name;
  }
  return chosen;
}

export async function postEmbeddings(
  namespace: DurableObjectNamespace<EmbedderContainer>,
  input: readonly string[],
): Promise<EmbedderReply> {
  const name = idleInstance(inFlight);
  inFlight.set(name, (inFlight.get(name) ?? 0) + 1);
  try {
    return await postTo(namespace, name, input);
  } finally {
    const pending = (inFlight.get(name) ?? 1) - 1;
    if (pending === 0) inFlight.delete(name);
    else inFlight.set(name, pending);
  }
}

export function warmPrimary(
  namespace: DurableObjectNamespace<EmbedderContainer>,
  input: readonly string[],
): Promise<EmbedderReply> {
  return postTo(namespace, EMBEDDER_INSTANCES[0], input);
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
