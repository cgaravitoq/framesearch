import type {
  D1Database,
  DurableObjectNamespace,
  R2Bucket,
  RateLimit,
} from "@cloudflare/workers-types";
import type { EmbedderContainer } from "../src/embedder.ts";
import type { Env } from "../src/env.ts";

export interface Query {
  sql: string;
  args: unknown[];
}

export interface FakeDb {
  db: D1Database;
  queries: Query[];
}

export interface FakeDbOptions {
  rows?: unknown[] | ((sql: string) => unknown[]);
  lastRowId?: number;
}

export function fakeDb(options: FakeDbOptions = {}): FakeDb {
  const queries: Query[] = [];
  const rowsFor = (sql: string): unknown[] => {
    const rows = options.rows ?? [];
    return typeof rows === "function" ? rows(sql) : rows;
  };
  const prepared = (rows: unknown[]) => ({
    all: async () => ({ results: rows, success: true, meta: {} }),
    first: async () => rows[0] ?? null,
    run: async () => ({
      results: [],
      success: true,
      meta: { changes: 1, last_row_id: options.lastRowId ?? 1 },
    }),
  });
  const prepare = (sql: string) => ({
    ...prepared(rowsFor(sql)),
    bind(...args: unknown[]) {
      queries.push({ sql, args });
      return prepared(rowsFor(sql));
    },
  });
  return { db: { prepare } as unknown as D1Database, queries };
}

export interface FakeR2 {
  bucket: R2Bucket;
  keys: string[];
  put: (key: string, bytes: Uint8Array) => void;
}

export function fakeR2(objects: Record<string, Uint8Array> = {}): FakeR2 {
  const keys: string[] = [];
  const uploads: Record<string, number> = {};
  let clock = 0;
  for (const key of Object.keys(objects)) {
    clock += 1;
    uploads[key] = clock;
  }
  const bucket = {
    head: async (key: string) => {
      const at = uploads[key];
      return at === undefined ? null : { uploaded: new Date(at) };
    },
    get: async (key: string) => {
      keys.push(key);
      const bytes = objects[key];
      return bytes === undefined
        ? null
        : { arrayBuffer: async () => bytes.slice().buffer };
    },
  };
  const put = (key: string, bytes: Uint8Array) => {
    clock += 1;
    objects[key] = bytes;
    uploads[key] = clock;
  };
  return { bucket: bucket as unknown as R2Bucket, keys, put };
}

export function fakeRateLimit(allowed: boolean): RateLimit {
  const limiter = { limit: async () => ({ success: allowed }) };
  return limiter as unknown as RateLimit;
}

export interface EmbedderCall {
  instance: string;
  path: string;
  input: unknown;
}

export interface FakeEmbedder {
  namespace: DurableObjectNamespace<EmbedderContainer>;
  calls: EmbedderCall[];
  release(): void;
}

export interface FakeEmbedderOptions {
  hold?: boolean;
  status?: number;
  vector?: number[];
}

export function fakeEmbedder(options: FakeEmbedderOptions = {}): FakeEmbedder {
  const calls: EmbedderCall[] = [];
  const waiting: (() => void)[] = [];
  const reply = (): Response =>
    options.status !== undefined && options.status !== 200
      ? new Response("embedder unavailable", { status: options.status })
      : new Response(
          JSON.stringify({
            data: [{ embedding: options.vector ?? [3, 4], index: 0 }],
          }),
          { headers: { "content-type": "application/json" } },
        );
  const stub = (instance: string) => ({
    fetch: async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({
        input: JSON.parse(body === "" ? "{}" : body),
        instance,
        path: new URL(url).pathname,
      });
      if (options.hold === true) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      return reply();
    },
  });
  const namespace = {
    getByName: (name: string) => stub(name),
    idFromName: (name: string) => name,
  };
  return {
    calls,
    namespace:
      namespace as unknown as DurableObjectNamespace<EmbedderContainer>,
    release: () => {
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

export function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: fakeDb().db,
    FRAMES: fakeR2().bucket,
    SEARCH_RATE_LIMIT: fakeRateLimit(true),
    ...overrides,
  };
}
