import { existsSync } from "node:fs";
import { frameKey, vectorsKey } from "@framesearch/schema";
import {
  type Cloud,
  mapBounded,
  UPLOAD_CONCURRENCY,
  wranglerCloud,
} from "./cloud.ts";
import { dataDir, dbFile } from "./paths.ts";
import { unpublishSql } from "./sql.ts";
import { openStore, readShots } from "./store.ts";
import { parseFilmArg, unwrap } from "./validate.ts";

export interface UnpublishOptions {
  dataDir?: string | undefined;
  cloud?: Cloud | undefined;
}

export interface UnpublishReport {
  film: string;
  frames: number;
  vectorsKey: string;
  seconds: number;
}

export async function unpublishFilm(
  rawSlug: string,
  options: UnpublishOptions = {},
): Promise<UnpublishReport> {
  const started = performance.now();
  const slug = unwrap(parseFilmArg(rawSlug));
  const dir = options.dataDir ?? dataDir();
  const cloud = options.cloud ?? wranglerCloud;
  const frames = [
    ...new Set([
      ...localFrames(dir, slug),
      ...(await cloud.publishedFrames(slug)),
    ]),
  ];
  const key = vectorsKey(slug);
  await cloud.deleteObject(key);
  await cloud.executeSql(unpublishSql(slug));
  await mapBounded(frames, UPLOAD_CONCURRENCY, (idx) =>
    cloud.deleteObject(frameKey(slug, idx)),
  );
  return {
    film: slug,
    frames: frames.length,
    vectorsKey: key,
    seconds: (performance.now() - started) / 1000,
  };
}

function localFrames(dir: string, film: string): number[] {
  if (!existsSync(dbFile(dir))) return [];
  const db = openStore(dir);
  try {
    return readShots(db, film).map((shot) => shot.idx);
  } finally {
    db.close();
  }
}
