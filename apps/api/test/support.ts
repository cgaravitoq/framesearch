import type {
  D1Database,
  R2Bucket,
  RateLimit,
} from "@cloudflare/workers-types";
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
  rows?: unknown[];
  lastRowId?: number;
}

export function fakeDb(options: FakeDbOptions = {}): FakeDb {
  const queries: Query[] = [];
  const rows = options.rows ?? [];
  const prepared = () => ({
    all: async () => ({ results: rows, success: true, meta: {} }),
    first: async () => rows[0] ?? null,
    run: async () => ({
      results: [],
      success: true,
      meta: { changes: 1, last_row_id: options.lastRowId ?? 1 },
    }),
  });
  const prepare = (sql: string) => ({
    ...prepared(),
    bind(...args: unknown[]) {
      queries.push({ sql, args });
      return prepared();
    },
  });
  return { db: { prepare } as unknown as D1Database, queries };
}

export interface FakeR2 {
  bucket: R2Bucket;
  keys: string[];
}

export function fakeR2(): FakeR2 {
  const keys: string[] = [];
  const bucket = {
    get: async (key: string) => {
      keys.push(key);
      return null;
    },
  };
  return { bucket: bucket as unknown as R2Bucket, keys };
}

export function fakeRateLimit(allowed: boolean): RateLimit {
  const limiter = { limit: async () => ({ success: allowed }) };
  return limiter as unknown as RateLimit;
}

export function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: fakeDb().db,
    FRAMES: fakeR2().bucket,
    SEARCH_RATE_LIMIT: fakeRateLimit(true),
    ...overrides,
  };
}
