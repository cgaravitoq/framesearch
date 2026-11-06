import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  publishedFilmsSql,
  publishedFramesSql,
  publishedVectorsSql,
} from "./sql.ts";

const WRANGLER = ["npx", "-y", "wrangler@4"];
const OUTPUT_TAIL = 400;
const API = "https://api.cloudflare.com/client/v4";
const OBJECTS_PAGE = 1000;
const STAMP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const UPLOAD_CONCURRENCY = 8;
const BULK_CHUNK = 200;
const RATE_ATTEMPTS = 8;
const RATE_WAIT_MS = 60_000;
const RETRYABLE_STATUS = /\b(429|500|502|503|504): /;

interface StoredObject {
  key: string;
  file: string;
  contentType: string;
}

export interface Cloud {
  putObjects(objects: readonly StoredObject[]): Promise<void>;
  deleteObject(key: string): Promise<void>;
  executeSql(sql: string): Promise<void>;
  publishedFilms(films: readonly string[]): Promise<string[]>;
  publishedFrames(film: string): Promise<number[]>;
  publishedVectors(film: string): Promise<PublishedVectors>;
  vectorsFiles(film: string): Promise<string[]>;
}

export interface PublishedVectors {
  current: string | null;
  prior: string | null;
}

interface D1Reply<Row> {
  results: Row[];
}

export function bucketName(): string {
  return process.env.FRAMESEARCH_R2_BUCKET ?? "framesearch";
}

export function databaseName(): string {
  return process.env.FRAMESEARCH_D1_DATABASE ?? "framesearch";
}

export async function putObjects(
  objects: readonly StoredObject[],
): Promise<void> {
  const byType = new Map<string, StoredObject[]>();
  for (const object of objects) {
    const sameType = byType.get(object.contentType);
    if (sameType === undefined) {
      byType.set(object.contentType, [object]);
      continue;
    }
    sameType.push(object);
  }
  for (const [contentType, batch] of byType) {
    for (let at = 0; at < batch.length; at += BULK_CHUNK) {
      await bulkPutPaced(batch.slice(at, at + BULK_CHUNK), contentType);
    }
  }
}

async function bulkPutPaced(
  objects: readonly StoredObject[],
  contentType: string,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await bulkPut(objects, contentType);
      return;
    } catch (error) {
      const limited =
        error instanceof Error && RETRYABLE_STATUS.test(error.message);
      if (!limited || attempt >= RATE_ATTEMPTS) throw error;
      await Bun.sleep(RATE_WAIT_MS);
    }
  }
}

async function bulkPut(
  objects: readonly StoredObject[],
  contentType: string,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "framesearch-bulk-"));
  try {
    const manifest = join(dir, "manifest.json");
    await writeFile(
      manifest,
      JSON.stringify(
        objects.map((object) => ({
          key: object.key,
          file: resolve(object.file),
        })),
      ),
    );
    await wrangler([
      "r2",
      "bulk",
      "put",
      bucketName(),
      "--filename",
      manifest,
      "--content-type",
      contentType,
      "--remote",
      "--force",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function deleteObject(key: string): Promise<void> {
  await wrangler([
    "r2",
    "object",
    "delete",
    `${bucketName()}/${key}`,
    "--remote",
  ]);
}

export async function vectorsFiles(film: string): Promise<string[]> {
  const identity = await apiIdentity();
  const prefix = `vectors/${film}-`;
  const keys: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const url = new URL(
      `${API}/accounts/${identity.account}/r2/buckets/${bucketName()}/objects`,
    );
    url.searchParams.set("per_page", String(OBJECTS_PAGE));
    url.searchParams.set("prefix", prefix);
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const page = await listObjects(url, identity.token);
    for (const object of page.result) {
      if (stampedFilm(object.key, prefix)) keys.push(object.key);
    }
    const next =
      page.result_info?.is_truncated === true
        ? page.result_info.cursor
        : undefined;
    if (next === undefined || next === "") return keys;
    cursor = next;
  }
}

export async function orphanedVectors(
  cloud: Cloud,
  film: string,
): Promise<string[]> {
  const listed = await cloud.vectorsFiles(film);
  const others = new Set(await cloud.publishedFilms(listed.map(plainFilm)));
  return listed.filter((key) => !others.has(plainFilm(key)));
}

function plainFilm(key: string): string {
  return key.slice("vectors/".length, -".bin".length);
}

function stampedFilm(key: string, prefix: string): boolean {
  if (!key.startsWith(prefix) || !key.endsWith(".bin")) return false;
  return STAMP.test(key.slice(prefix.length, -4));
}

export async function executeSql(sql: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "framesearch-wrangler-"));
  try {
    const file = join(dir, "statements.sql");
    await writeFile(file, sql);
    await wrangler([
      "d1",
      "execute",
      databaseName(),
      "--remote",
      "--yes",
      "--file",
      file,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function publishedFilms(
  films: readonly string[],
): Promise<string[]> {
  if (films.length === 0) return [];
  const stdout = await wrangler([
    "d1",
    "execute",
    databaseName(),
    "--remote",
    "--json",
    "--command",
    publishedFilmsSql(films),
  ]);
  const [reply] = JSON.parse(stdout) as D1Reply<{ film: string }>[];
  return reply?.results.map((row) => row.film) ?? [];
}

export async function publishedFrames(film: string): Promise<number[]> {
  const stdout = await wrangler([
    "d1",
    "execute",
    databaseName(),
    "--remote",
    "--json",
    "--command",
    publishedFramesSql(film),
  ]);
  const [reply] = JSON.parse(stdout) as D1Reply<{ idx: number }>[];
  return reply?.results.map((row) => row.idx) ?? [];
}

export async function publishedVectors(
  film: string,
): Promise<PublishedVectors> {
  const stdout = await wrangler([
    "d1",
    "execute",
    databaseName(),
    "--remote",
    "--json",
    "--command",
    publishedVectorsSql(film),
  ]);
  const [reply] = JSON.parse(stdout) as D1Reply<PublishedVectors>[];
  const row = reply?.results[0];
  return { current: row?.current ?? null, prior: row?.prior ?? null };
}

export const wranglerCloud: Cloud = {
  deleteObject,
  executeSql,
  publishedFilms,
  publishedFrames,
  publishedVectors,
  putObjects,
  vectorsFiles,
};

export async function mapBounded<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      await work(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

export async function wrangler(args: readonly string[]): Promise<string> {
  const proc = Bun.spawn({
    cmd: [...WRANGLER, ...args],
    cwd: tmpdir(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `wrangler ${args.slice(0, 4).join(" ")} failed (${code}): ${stderr.trim().slice(-OUTPUT_TAIL)}`,
    );
  }
  return stdout;
}

interface ApiIdentity {
  account: string;
  token: string;
}

interface ObjectsPage {
  result: { key: string }[];
  result_info?:
    | { cursor?: string | undefined; is_truncated?: boolean | undefined }
    | undefined;
}

async function apiIdentity(): Promise<ApiIdentity> {
  const configured = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  return {
    account: configured === "" ? await onlyAccount() : configured,
    token: token === "" ? await authToken() : token,
  };
}

async function authToken(): Promise<string> {
  const token = tokenField(await wrangler(["auth", "token", "--json"]));
  if (token === "") {
    throw new Error(
      "wrangler printed no API token; log in with `wrangler login` or set CLOUDFLARE_API_TOKEN",
    );
  }
  return token;
}

function tokenField(stdout: string): string {
  let reply: unknown;
  try {
    reply = JSON.parse(stdout);
  } catch {
    return "";
  }
  if (typeof reply !== "object" || reply === null || !("token" in reply)) {
    return "";
  }
  return typeof reply.token === "string" ? reply.token : "";
}

async function onlyAccount(): Promise<string> {
  const reply = JSON.parse(await wrangler(["whoami", "--json"])) as {
    accounts?: { id?: unknown }[] | undefined;
  };
  const ids = (reply.accounts ?? [])
    .map((account) => account.id)
    .filter((id): id is string => typeof id === "string");
  const [id] = ids;
  if (ids.length !== 1 || id === undefined) {
    throw new Error(
      `wrangler is logged in to ${ids.length} accounts; set CLOUDFLARE_ACCOUNT_ID`,
    );
  }
  return id;
}

async function listObjects(url: URL, token: string): Promise<ObjectsPage> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`listing ${url.pathname} failed (${response.status})`);
  }
  return (await response.json()) as ObjectsPage;
}
