import { describe, expect, test } from "bun:test";
import { embedText } from "@framesearch/core";
import { EMBEDDER_INSTANCES, idleInstance } from "../src/embedder-routing.ts";
import {
  type Embeddings,
  embeddingsConfig,
  embedQuery,
  prewarmEmbeddings,
} from "../src/embeddings.ts";
import { fakeEmbedder, fakeEnv } from "./support.ts";

describe("embeddings config", () => {
  test("prefers EMBED_URL so a local llama.cpp still serves without the container", () => {
    const embedder = fakeEmbedder();
    const config = embeddingsConfig(
      fakeEnv({
        EMBEDDER: embedder.namespace,
        EMBED_API_KEY: "secret",
        EMBED_MODEL: "embeddinggemma-2",
        EMBED_URL: "http://127.0.0.1:8104",
      }),
    );
    expect(config).toEqual({
      endpoint: "http://127.0.0.1:8104/v1/embeddings",
      key: "secret",
      kind: "url",
      model: "embeddinggemma-2",
    });
  });

  test("falls back to the container when no URL is set", () => {
    const embedder = fakeEmbedder();
    const config = embeddingsConfig(fakeEnv({ EMBEDDER: embedder.namespace }));
    expect(config?.kind).toBe("container");
  });

  test("answers null when neither the URL nor the container is bound", () => {
    expect(embeddingsConfig(fakeEnv())).toBeNull();
  });

  test("answers null for a half-configured URL", () => {
    expect(
      embeddingsConfig(fakeEnv({ EMBED_URL: "http://127.0.0.1:8104" })),
    ).toBeNull();
  });
});

describe("container embeddings", () => {
  test("asks the shared instance for the prefixed query and normalizes it", async () => {
    const embedder = fakeEmbedder({ vector: [3, 4] });
    const config: Embeddings = {
      kind: "container",
      namespace: embedder.namespace,
    };
    const vector = await embedQuery(config, "a zombie in a graveyard");
    expect([...vector].map((value) => Number(value.toFixed(6)))).toEqual([
      0.6, 0.8,
    ]);
    expect(embedder.calls).toEqual([
      {
        input: { input: [embedText("a zombie in a graveyard")] },
        instance: "primary",
        path: "/v1/embeddings",
      },
    ]);
  });

  test("reports the status when the container cannot embed", async () => {
    const embedder = fakeEmbedder({ status: 503 });
    const config: Embeddings = {
      kind: "container",
      namespace: embedder.namespace,
    };
    expect(embedQuery(config, "fire")).rejects.toThrow("answered 503");
  });

  test("refuses a reply without a vector", async () => {
    const embedder = fakeEmbedder({ vector: [] });
    const config: Embeddings = {
      kind: "container",
      namespace: embedder.namespace,
    };
    expect(embedQuery(config, "fire")).rejects.toThrow("returned no vector");
  });
});

describe("container instances", () => {
  test("fills the shared instance before the overflow ones", () => {
    const empty = new Map<string, number>();
    expect(idleInstance(empty)).toBe("primary");
    expect(idleInstance(new Map([["primary", 1]]))).toBe("overflow-1");
    expect(
      idleInstance(
        new Map([
          ["primary", 2],
          ["overflow-1", 1],
        ]),
      ),
    ).toBe("overflow-2");
  });

  test("never overflows past the capped instances", () => {
    const busy = new Map(EMBEDDER_INSTANCES.map((name) => [name, 4]));
    const chosen = idleInstance(busy);
    expect(EMBEDDER_INSTANCES as readonly string[]).toContain(chosen);
  });

  test("spreads concurrent queries over the pool and returns to the shared instance", async () => {
    const embedder = fakeEmbedder({ hold: true });
    const config: Embeddings = {
      kind: "container",
      namespace: embedder.namespace,
    };
    const pending = [
      embedQuery(config, "a"),
      embedQuery(config, "b"),
      embedQuery(config, "c"),
      embedQuery(config, "d"),
    ];
    const instances = embedder.calls.map((call) => call.instance);
    expect(instances).toEqual([...EMBEDDER_INSTANCES, "primary"]);
    embedder.release();
    await Promise.all(pending);
    const reused = embedQuery(config, "e");
    embedder.release();
    await reused;
    expect(embedder.calls.at(-1)?.instance).toBe("primary");
  });
});

describe("prewarm", () => {
  test("wakes the shared instance with one embedding", async () => {
    const embedder = fakeEmbedder();
    const warm = await prewarmEmbeddings(
      fakeEnv({ EMBEDDER: embedder.namespace }),
    );
    expect(warm).toBe(true);
    expect(embedder.calls).toEqual([
      {
        input: { input: ["warm"] },
        instance: "primary",
        path: "/v1/embeddings",
      },
    ]);
  });

  test("wakes only the shared instance and leaves it free for searches", async () => {
    const embedder = fakeEmbedder({ hold: true });
    const env = fakeEnv({ EMBEDDER: embedder.namespace });
    const config: Embeddings = {
      kind: "container",
      namespace: embedder.namespace,
    };
    const searching = embedQuery(config, "a");
    const warming = prewarmEmbeddings(env);
    const after = embedQuery(config, "b");
    expect(embedder.calls.map((call) => call.instance)).toEqual([
      "primary",
      "primary",
      "overflow-1",
    ]);
    embedder.release();
    await Promise.all([searching, warming, after]);
    const warmingAgain = prewarmEmbeddings(env);
    const next = embedQuery(config, "c");
    embedder.release();
    await Promise.all([warmingAgain, next]);
    expect(embedder.calls.slice(-2).map((call) => call.instance)).toEqual([
      "primary",
      "primary",
    ]);
  });

  test("does nothing when a remote URL serves the embeddings", async () => {
    const embedder = fakeEmbedder();
    const warm = await prewarmEmbeddings(
      fakeEnv({
        EMBEDDER: embedder.namespace,
        EMBED_API_KEY: "secret",
        EMBED_MODEL: "embeddinggemma-2",
        EMBED_URL: "http://127.0.0.1:8104",
      }),
    );
    expect(warm).toBe(false);
    expect(embedder.calls).toEqual([]);
  });

  test("does nothing when no embedder is bound", async () => {
    expect(await prewarmEmbeddings(fakeEnv())).toBe(false);
  });
});
