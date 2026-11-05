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
  const configured = process.env.FRAMESEARCH_DATA;
  if (configured === undefined) return DEFAULT_DATA_DIR;
  const dir = configured.trim();
  if (dir === "") {
    throw new Error(
      `FRAMESEARCH_DATA is set but empty; unset it to use ${DEFAULT_DATA_DIR}`,
    );
  }
  return dir;
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
