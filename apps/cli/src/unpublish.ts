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
  vectorsKeys: string[];
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
  const live = await cloud.publishedVectors(slug);
  const frames = [
    ...new Set([
      ...localFrames(dir, slug),
      ...(await cloud.publishedFrames(slug)),
    ]),
  ];
  const keys = [
    ...new Set(
      [vectorsKey(slug), live.current, live.prior].filter(
        (key): key is string => key !== null,
      ),
    ),
  ];
  await cloud.executeSql(unpublishSql(slug));
  await mapBounded(keys, UPLOAD_CONCURRENCY, (key) => cloud.deleteObject(key));
  await mapBounded(frames, UPLOAD_CONCURRENCY, (idx) =>
    cloud.deleteObject(frameKey(slug, idx)),
  );
  return {
    film: slug,
    frames: frames.length,
    vectorsKeys: keys,
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
