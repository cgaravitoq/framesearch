import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { embedText } from "@framesearch/core";
import {
  EMBEDDER_INSTANCES,
  type EmbedTrace,
  postEmbeddings,
} from "../src/embedder-routing.ts";
import {
  EmbedderBusy,
  type Embeddings,
  embeddingsConfig,
  embedQuery,
  prewarmEmbeddings,
} from "../src/embeddings.ts";
import {
  fakeEmbedder,
  fakeEnv,
  fakeRateLimit,
  withFakeTime,
} from "./support.ts";

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
    const embedder = fakeEmbedder({ answer: 400 });
    const config: Embeddings = {
      kind: "container",
      namespace: embedder.namespace,
    };
    expect(embedQuery(config, "fire")).rejects.toThrow("answered 400");
    expect(embedder.calls).toHaveLength(1);
  });

  test("refuses a reply without a vector", async () => {
    const embedder = fakeEmbedder({ vector: [] });
    const config: Embeddings = {
      kind: "container",
      namespace: embedder.namespace,
    };
    expect(embedQuery(config, "fire")).rejects.toThrow("returned no vector");
  });

  test("reports busy once every instance stayed busy past the wait budget", async () => {
    const embedder = fakeEmbedder({ answer: "busy" });
    const config: Embeddings = {
      kind: "container",
      namespace: embedder.namespace,
    };
    await expect(
      withFakeTime(() => embedQuery(config, "fire")),
    ).rejects.toThrow(EmbedderBusy);
    expect(embedder.calls.length).toBeGreaterThan(EMBEDDER_INSTANCES.length);
  });
});

describe("container instances", () => {
  test("keeps the instance list on the deployed cap", () => {
    const config = JSON.parse(
      readFileSync(`${import.meta.dir}/../wrangler.jsonc`, "utf8"),
    ) as { containers?: { max_instances?: number }[] };
    const cap = config.containers?.[0]?.max_instances;
    expect(cap).toBe(EMBEDDER_INSTANCES.length);
    expect(new Set(EMBEDDER_INSTANCES).size).toBe(EMBEDDER_INSTANCES.length);
  });

  test("moves to the next instance when the package reports no instance available", async () => {
    const embedder = fakeEmbedder({
      answer: (instance) => (instance === "primary" ? 503 : 200),
    });
    const reply = await postEmbeddings(embedder.namespace, ["a"]);
    expect(reply.ok).toBe(true);
    expect(embedder.calls.map((call) => call.instance)).toEqual([
      "primary",
      "overflow-1",
    ]);
  });

  test("moves to the next instance when one answers busy", async () => {
    const embedder = fakeEmbedder({
      answer: (instance) => (instance === "primary" ? "busy" : 200),
    });
    const reply = await postEmbeddings(embedder.namespace, ["a"]);
    expect(reply.ok).toBe(true);
    expect(embedder.calls.map((call) => call.instance)).toEqual([
      "primary",
      "overflow-1",
    ]);
  });

  test("retries a 502 once and no further", async () => {
    const embedder = fakeEmbedder({ answer: 502 });
    const reply = await postEmbeddings(embedder.namespace, ["a"]);
    expect(reply.status).toBe(502);
    expect(embedder.calls.map((call) => call.instance)).toEqual([
      "primary",
      "overflow-1",
    ]);
  });

  test("retries the 500 a container restart answers with on the next instance", async () => {
    const embedder = fakeEmbedder({
      answer: (instance) => (instance === "primary" ? 500 : 200),
    });
    const reply = await postEmbeddings(embedder.namespace, ["a"]);
    expect(reply.ok).toBe(true);
    expect(embedder.calls.map((call) => call.instance)).toEqual([
      "primary",
      "overflow-1",
    ]);
  });

  test("retries a connection failure on the next instance", async () => {
    const embedder = fakeEmbedder({ unreachable: ["primary"] });
    const reply = await postEmbeddings(embedder.namespace, ["a"]);
    expect(reply.ok).toBe(true);
    expect(embedder.calls.map((call) => call.instance)).toEqual(["overflow-1"]);
  });

  test("answers a 4xx without retrying", async () => {
    const embedder = fakeEmbedder({ answer: 400 });
    const reply = await postEmbeddings(embedder.namespace, ["a"]);
    expect(reply.status).toBe(400);
    expect(embedder.calls.map((call) => call.instance)).toEqual(["primary"]);
  });

  test("waits on the shared instance once every instance is busy", async () => {
    const embedder = fakeEmbedder({
      answer: (instance, seen) =>
        instance === "primary" && seen > 2 ? 200 : "busy",
    });
    const reply = await postEmbeddings(embedder.namespace, ["a"]);
    expect(reply.ok).toBe(true);
    expect(embedder.calls.map((call) => call.instance)).toEqual([
      "primary",
      "overflow-1",
      "overflow-2",
      "primary",
      "primary",
      "primary",
    ]);
  });

  test("spreads concurrent queries over the pool", async () => {
    const embedder = fakeEmbedder({ hold: true });
    const config: Embeddings = {
      kind: "container",
      namespace: embedder.namespace,
    };
    const pending = [
      embedQuery(config, "a"),
      embedQuery(config, "b"),
      embedQuery(config, "c"),
    ];
    await Bun.sleep(0);
    expect(embedder.calls.map((call) => call.instance)).toEqual([
      "primary",
      "primary",
      "primary",
      "overflow-1",
      "overflow-1",
      "overflow-2",
    ]);
    embedder.release();
    await Promise.all(pending);
  });
});

describe("embed trace", () => {
  const trace = (): EmbedTrace => ({
    attempts: [],
    busy: 0,
    containerMs: 0,
    ms: 0,
  });

  test("names each instance it tried and counts the busy ones", async () => {
    const seen = trace();
    const embedder = fakeEmbedder({
      answer: (instance) => (instance === "primary" ? "busy" : 200),
    });
    await postEmbeddings(embedder.namespace, ["a"], seen);
    expect(seen.attempts).toEqual(["primary", "overflow-1"]);
    expect(seen.busy).toBe(1);
  });

  test("adds up the milliseconds the instances report for the container", async () => {
    const seen = trace();
    const embedder = fakeEmbedder({ containerMs: 37 });
    await postEmbeddings(embedder.namespace, ["a"], seen);
    expect(seen.containerMs).toBe(37);
  });

  test("counts the busy polls while it waits on the shared instance", async () => {
    const seen = trace();
    const embedder = fakeEmbedder({
      answer: (instance, before) =>
        instance === "primary" && before > 2 ? 200 : "busy",
    });
    await postEmbeddings(embedder.namespace, ["a"], seen);
    expect(seen.attempts).toEqual([
      "primary",
      "overflow-1",
      "overflow-2",
      "primary",
      "primary",
      "primary",
    ]);
    expect(seen.busy).toBe(5);
  });
});

describe("prewarm", () => {
  test("wakes the shared instance with one embedding", async () => {
    const embedder = fakeEmbedder();
    const warm = await prewarmEmbeddings(
      fakeEnv({ EMBEDDER: embedder.namespace }),
      "203.0.113.7",
    );
    expect(warm).toBe("warm");
    expect(embedder.calls).toEqual([
      {
        input: { input: ["warm"] },
        instance: "primary",
        path: "/v1/embeddings",
      },
    ]);
  });

  test("counts a busy shared instance as warm", async () => {
    const embedder = fakeEmbedder({ answer: "busy" });
    const warm = await prewarmEmbeddings(
      fakeEnv({ EMBEDDER: embedder.namespace }),
      "203.0.113.7",
    );
    expect(warm).toBe("warm");
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
      "203.0.113.7",
    );
    expect(warm).toBe("skipped");
    expect(embedder.calls).toEqual([]);
  });

  test("does nothing when no embedder is bound", async () => {
    expect(await prewarmEmbeddings(fakeEnv(), "203.0.113.7")).toBe("skipped");
  });

  test("refuses to wake the container past the address's rate limit", async () => {
    const embedder = fakeEmbedder();
    const keys: string[] = [];
    const limiter = fakeRateLimit(false);
    const warm = await prewarmEmbeddings(
      fakeEnv({
        EMBEDDER: embedder.namespace,
        SEARCH_RATE_LIMIT: {
          limit: async (options: { key: string }) => {
            keys.push(options.key);
            return await limiter.limit(options);
          },
        },
      }),
      "203.0.113.7",
    );
    expect(warm).toBe("limited");
    expect(keys).toEqual(["prewarm:203.0.113.7"]);
    expect(embedder.calls).toEqual([]);
  });
});

describe("embedder image", () => {
  const dockerfile = readFileSync(
    `${import.meta.dir}/../../embedder/Dockerfile`,
    "utf8",
  );

  test("builds from a base image pinned by digest and installs no apt package", () => {
    const bases = dockerfile.match(/^FROM .+$/gm) ?? [];
    expect(bases.length).toBeGreaterThan(0);
    for (const base of bases) expect(base).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(dockerfile).not.toMatch(/apt-get|apt install/);
  });

  test("names a fixed commit for every download", () => {
    expect(dockerfile).toMatch(/^ARG LLAMA_TAG=b\d+$/m);
    expect(dockerfile).toMatch(/^ARG MODEL_COMMIT=[0-9a-f]{40}$/m);
    const downloads = dockerfile.match(/^ADD (https:\/\/\S+)/gm) ?? [];
    expect(downloads).toHaveLength(2);
    for (const download of downloads) {
      expect(download).toMatch(/\$\{LLAMA_TAG\}|\$\{MODEL_COMMIT\}/);
    }
  });

  test("copies every .deb from the vendored build context, never the network", () => {
    expect(dockerfile).not.toMatch(/^ADD \S+\.deb /m);
    const debs = [...dockerfile.matchAll(/^COPY vendor\/(\S+_amd64\.deb) /gm)];
    expect(debs).toHaveLength(2);
    for (const deb of debs) {
      expect(
        existsSync(`${import.meta.dir}/../../embedder/vendor/${deb[1]}`),
      ).toBe(true);
    }
  });

  test("checks every download against a pinned sha256", () => {
    const pins = [
      ...dockerfile.matchAll(/^ARG (\w+_SHA256)=([0-9a-f]{64})$/gm),
    ];
    expect(pins.map((pin) => pin[1]).sort()).toEqual([
      "LIBBROTLI_SHA256",
      "LIBGOMP_SHA256",
      "LLAMA_SHA256",
      "MODEL_SHA256",
    ]);
    for (const pin of pins) expect(dockerfile).toContain(`"\${${pin[1]}}  `);
    expect(dockerfile.match(/sha256sum -c -/g)).toHaveLength(pins.length);
  });
});
