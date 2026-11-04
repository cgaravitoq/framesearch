import { homedir } from "node:os";
import { join } from "node:path";
import { frameKey, vectorsKey } from "@framesearch/schema";

export const DEFAULT_DATA_DIR = join(
  homedir(),
  ".local",
  "share",
  "framesearch-public",
);

export function dataDir(): string {
  return process.env.FRAMESEARCH_DATA ?? DEFAULT_DATA_DIR;
}

export function dbFile(dir: string): string {
  return join(dir, "framesearch.db");
}

export function filmFramesDir(dir: string, film: string): string {
  return join(dir, "frames", film);
}

export function frameFile(dir: string, film: string, idx: number): string {
  return join(dir, frameKey(film, idx));
}

export function vectorsFile(dir: string, film: string): string {
  return join(dir, vectorsKey(film));
}
