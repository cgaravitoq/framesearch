import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishedFramesSql } from "./sql.ts";

const WRANGLER = ["npx", "-y", "wrangler@4"];
const OUTPUT_TAIL = 400;

export const UPLOAD_CONCURRENCY = 8;

export interface Cloud {
  putObject(key: string, file: string, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  executeSql(sql: string): Promise<void>;
  publishedFrames(film: string): Promise<number[]>;
}

interface D1Reply {
  results: { idx: number }[];
}

export function bucketName(): string {
  return process.env.FRAMESEARCH_R2_BUCKET ?? "framesearch-staging";
}

export function databaseName(): string {
  return process.env.FRAMESEARCH_D1_DATABASE ?? "framesearch-staging";
}

export async function putObject(
  key: string,
  file: string,
  contentType: string,
): Promise<void> {
  await wrangler([
    "r2",
    "object",
    "put",
    `${bucketName()}/${key}`,
    "--file",
    file,
    "--content-type",
    contentType,
    "--remote",
  ]);
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
  const [reply] = JSON.parse(stdout) as D1Reply[];
  return reply?.results.map((row) => row.idx) ?? [];
}

export const wranglerCloud: Cloud = {
  putObject,
  deleteObject,
  executeSql,
  publishedFrames,
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

async function wrangler(args: readonly string[]): Promise<string> {
  const proc = Bun.spawn({
    cmd: [...WRANGLER, ...args],
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
