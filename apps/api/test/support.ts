import { jest } from "bun:test";
import type {
  D1Database,
  DurableObjectNamespace,
  R2Bucket,
  RateLimit,
} from "@cloudflare/workers-types";
import type { EmbedderContainer } from "../src/embedder.ts";
import { busyReply } from "../src/embedder-routing.ts";
import type { Env } from "../src/env.ts";

export interface Query {
  sql: string;
  args: unknown[];
}

export interface FakeSession {
  constraint: string | undefined;
  queries: Query[];
  statements: string[];
}

export interface FakeDb {
  db: D1Database;
  queries: Query[];
  statements: string[];
  sessions: FakeSession[];
}

export interface FakeDbOptions {
  delayMs?: number | undefined;
  rows?: unknown[] | ((sql: string) => unknown[]);
  lastRowId?: number;
}

export function fakeDb(options: FakeDbOptions = {}): FakeDb {
  const queries: Query[] = [];
  const statements: string[] = [];
  const sessions: FakeSession[] = [];
  const wait = async (): Promise<void> => {
    if (options.delayMs === undefined) return;
    await new Promise<void>((settle) => setTimeout(settle, options.delayMs));
  };
  const rowsFor = (sql: string): unknown[] => {
    const rows = options.rows ?? [];
    return typeof rows === "function" ? rows(sql) : rows;
  };
  const prepared = (rows: unknown[]) => ({
    all: async () => {
      await wait();
      return { results: rows, success: true, meta: {} };
    },
    first: async () => {
      await wait();
      return rows[0] ?? null;
    },
    run: async () => {
      await wait();
      return {
        results: [],
        success: true,
        meta: { changes: 1, last_row_id: options.lastRowId ?? 1 },
      };
    },
  });
  const prepareFor = (sinks: string[][], bound: Query[]) => (sql: string) => {
    for (const sink of sinks) sink.push(sql);
    const rows = rowsFor(sql);
    const statement = prepared(rows);
    return {
      all: async () => {
        bound.push({ args: [], sql });
        return await statement.all();
      },
      first: async () => {
        bound.push({ args: [], sql });
        return await statement.first();
      },
      run: async () => {
        bound.push({ args: [], sql });
        return await statement.run();
      },
      bind(...args: unknown[]) {
        bound.push({ args, sql });
        return prepared(rows);
      },
    };
  };
  const db = {
    prepare: prepareFor([statements], queries),
    withSession(constraint?: string) {
      const session: FakeSession = {
        constraint,
        queries: [],
        statements: [],
      };
      sessions.push(session);
      return {
        prepare: prepareFor([statements, session.statements], session.queries),
      };
    },
  };
  return {
    db: db as unknown as D1Database,
    queries,
    sessions,
    statements,
  };
}

export interface FakeR2 {
  bucket: R2Bucket;
  keys: string[];
  heads: string[];
  put: (key: string, bytes: Uint8Array) => void;
}

export function fakeR2(objects: Record<string, Uint8Array> = {}): FakeR2 {
  const keys: string[] = [];
  const heads: string[] = [];
  const uploads: Record<string, number> = {};
  let clock = 0;
  for (const key of Object.keys(objects)) {
    clock += 1;
    uploads[key] = clock;
  }
  const bucket = {
    head: async (key: string) => {
      heads.push(key);
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
  return { bucket: bucket as unknown as R2Bucket, heads, keys, put };
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
  answer?: FakeAnswer | ((instance: string, seen: number) => FakeAnswer);
  containerMs?: number;
  hold?: boolean;
  unreachable?: readonly string[];
  vector?: number[];
}

export type FakeAnswer = number | "busy";

export function fakeEmbedder(options: FakeEmbedderOptions = {}): FakeEmbedder {
  const calls: EmbedderCall[] = [];
  const waiting: (() => void)[] = [];
  const occupied = new Set<string>();
  const seen = new Map<string, number>();
  const answerFor = (instance: string): FakeAnswer => {
    const before = seen.get(instance) ?? 0;
    seen.set(instance, before + 1);
    const scripted = options.answer ?? 200;
    return typeof scripted === "function"
      ? scripted(instance, before)
      : scripted;
  };
  const reply = (answer: FakeAnswer): Response => {
    const stamp = options.containerMs;
    if (answer === "busy") return busyReply();
    if (answer !== 200) {
      return new Response("embedder unavailable", { status: answer });
    }
    return new Response(
      JSON.stringify({
        data: [{ embedding: options.vector ?? [3, 4], index: 0 }],
      }),
      {
        headers: {
          "content-type": "application/json",
          ...(stamp === undefined ? {} : { "x-embedder-ms": String(stamp) }),
        },
      },
    );
  };
  const stub = (instance: string) => ({
    fetch: async (url: string, init?: RequestInit) => {
      if (options.unreachable?.includes(instance) === true) {
        throw new Error(`no embedder at ${instance}`);
      }
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({
        input: JSON.parse(body === "" ? "{}" : body),
        instance,
        path: new URL(url).pathname,
      });
      const answer = answerFor(instance);
      if (answer === "busy") return reply(answer);
      if (options.hold === true && occupied.has(instance)) return busyReply();
      if (options.hold === true) {
        occupied.add(instance);
        await new Promise<void>((resolve) =>
          waiting.push(() => {
            occupied.delete(instance);
            resolve();
          }),
        );
      }
      return reply(answer);
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
    SEARCH_LOG: true,
    SEARCH_RATE_LIMIT: fakeRateLimit(true),
    ...overrides,
  };
}

export async function withFakeTime<T>(work: () => Promise<T>): Promise<T> {
  jest.useFakeTimers();
  try {
    return await advanceThrough(work(), 1_000);
  } finally {
    jest.useRealTimers();
  }
}

async function advanceThrough<T>(work: Promise<T>, stepMs: number): Promise<T> {
  let settled = false;
  const settle = (): void => {
    settled = true;
  };
  void work.then(settle, settle);
  for (let step = 0; step < 40 && !settled; step += 1) {
    for (let drain = 0; drain < 20; drain += 1) await Promise.resolve();
    jest.advanceTimersByTime(stepMs);
  }
  return await work;
}
