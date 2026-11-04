import { embedText } from "@framesearch/core";
import type { Env } from "./env.ts";

export interface Embeddings {
  endpoint: string;
  key: string;
  model: string;
}

export function embeddingsConfig(env: Env): Embeddings | null {
  const url = env.EMBED_URL?.trim() ?? "";
  const key = env.EMBED_API_KEY?.trim() ?? "";
  const model = env.EMBED_MODEL?.trim() ?? "";
  if (url === "" || key === "" || model === "") return null;
  return { endpoint: endpointOf(url), key, model };
}

export async function embedQuery(
  config: Embeddings,
  query: string,
): Promise<Float32Array> {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ input: [embedText(query)], model: config.model }),
  });
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
