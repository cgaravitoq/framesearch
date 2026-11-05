import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import { embedText } from "@framesearch/core";
import type { EmbedderContainer } from "./embedder.ts";
import {
  type EmbedderReply,
  isBusy,
  postEmbeddings,
  warmPrimary,
} from "./embedder-routing.ts";
import type { Env } from "./env.ts";

export type Embeddings =
  | { kind: "url"; endpoint: string; key: string; model: string }
  | {
      kind: "container";
      namespace: DurableObjectNamespace<EmbedderContainer>;
    };

type Remote = Extract<Embeddings, { kind: "url" }>;

const PREWARM_TEXT = "warm";

export function embeddingsConfig(env: Env): Embeddings | null {
  const url = env.EMBED_URL?.trim() ?? "";
  if (url !== "") {
    const key = env.EMBED_API_KEY?.trim() ?? "";
    const model = env.EMBED_MODEL?.trim() ?? "";
    if (key === "" || model === "") return null;
    return { endpoint: endpointOf(url), key, kind: "url", model };
  }
  return env.EMBEDDER === undefined
    ? null
    : { kind: "container", namespace: env.EMBEDDER };
}

export async function embedQuery(
  config: Embeddings,
  query: string,
): Promise<Float32Array> {
  const input = embedText(query);
  const response =
    config.kind === "url"
      ? await postRemote(config, input)
      : await postEmbeddings(config.namespace, [input]);
  if (isBusy(response)) throw new EmbedderBusy();
  return await parseVector(response, query);
}

export type Prewarm = "warm" | "skipped" | "limited";

export class EmbedderBusy extends Error {
  constructor() {
    super("the embedder stayed busy past the wait budget");
    this.name = "EmbedderBusy";
  }
}

export async function prewarmEmbeddings(
  env: Env,
  address: string,
): Promise<Prewarm> {
  const config = embeddingsConfig(env);
  if (config === null || config.kind !== "container") return "skipped";
  const { success } = await env.SEARCH_RATE_LIMIT.limit({
    key: `prewarm:${address}`,
  });
  if (!success) return "limited";
  const response = await warmPrimary(config.namespace, [PREWARM_TEXT]);
  if (!response.ok && !isBusy(response)) {
    throw new Error(
      `the embedder answered ${response.status} to the prewarm request`,
    );
  }
  return "warm";
}

function postRemote(config: Remote, input: string): Promise<EmbedderReply> {
  return fetch(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ input: [input], model: config.model }),
  });
}

async function parseVector(
  response: EmbedderReply,
  query: string,
): Promise<Float32Array> {
  if (!response.ok) {
    throw new Error(
      `the embeddings endpoint answered ${response.status} for "${query}"`,
    );
  }
  const payload = (await response.json()) as {
    data?: { embedding?: unknown }[] | undefined;
  };
  const vector = payload.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("the embeddings endpoint returned no vector");
  }
  const values = new Float32Array(vector.length);
  for (let at = 0; at < vector.length; at += 1) {
    const value: unknown = vector[at];
    if (typeof value !== "number") {
      throw new Error("the embeddings endpoint returned a non-numeric vector");
    }
    values[at] = value;
  }
  return normalize(values);
}

function endpointOf(base: string): string {
  const url = new URL(base);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/embeddings")) return url.toString();
  url.pathname = path === "" ? "/v1/embeddings" : `${path}/embeddings`;
  return url.toString();
}

function normalize(values: Float32Array): Float32Array {
  let sum = 0;
  for (const value of values) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return values;
  const out = new Float32Array(values.length);
  for (let at = 0; at < values.length; at += 1) {
    out[at] = (values[at] ?? 0) / norm;
  }
  return out;
}
