import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  decodeVectors,
  frameKey,
  thumbKey,
  vectorsKey,
} from "@framesearch/schema";
import {
  type Cloud,
  mapBounded,
  orphanedVectors,
  UPLOAD_CONCURRENCY,
  wranglerCloud,
} from "./cloud.ts";
import { frameSizes } from "./ffmpeg.ts";
import { dataDir, frameFile, vectorsFile } from "./paths.ts";
import { publishedVersionSql, publishSql } from "./sql.ts";
import { openStore, readFilm, readShots } from "./store.ts";
import { parseFilmArg, unwrap } from "./validate.ts";
import { assertVectorsMatch } from "./vectors.ts";

interface PublishOptions {
  dataDir?: string | undefined;
  cloud?: Cloud | undefined;
  resize?: typeof frameSizes | undefined;
}

const RESIZE_CONCURRENCY = 4;

interface PublishReport {
  film: string;
  shots: number;
  captions: number;
  frames: number;
  vectorsKey: string;
  vectorBytes: number;
  seconds: number;
}

export async function publishFilm(
  rawSlug: string,
  options: PublishOptions = {},
): Promise<PublishReport> {
  const started = performance.now();
  const slug = unwrap(parseFilmArg(rawSlug));
  const dir = options.dataDir ?? dataDir();
  const cloud = options.cloud ?? wranglerCloud;
  const resize = options.resize ?? frameSizes;
  const db = openStore(dir);
  let sized: string | undefined;
  try {
    const film = readFilm(db, slug);
    if (film === null) {
      throw new Error(`film ${slug} is not in the local store at ${dir}`);
    }
    const shots = readShots(db, slug);
    if (shots.length === 0) {
      throw new Error(`film ${slug} holds no shots in the local store`);
    }
    const localVectors = vectorsFile(dir, slug);
    if (!existsSync(localVectors)) {
      throw new Error(
        `no vectors file at ${localVectors}; index ${slug} again`,
      );
    }
    const vectors = decodeVectors(await Bun.file(localVectors).bytes());
    assertVectorsMatch(shots, vectors);

    const sources = shots.map((shot) => frameFile(dir, slug, shot.idx));
    const missing = sources.filter((source) => !existsSync(source));
    const firstMissing = missing[0];
    if (firstMissing !== undefined) {
      throw new Error(
        `${missing.length} frames are missing from the local store, first ${firstMissing}`,
      );
    }
    const out = await mkdtemp(join(dir, "tmp-sizes-"));
    sized = out;
    const frames = shots.flatMap((shot) => [
      { key: frameKey(slug, shot.idx), file: join(out, `${shot.idx}.jpg`) },
      { key: thumbKey(slug, shot.idx), file: join(out, `${shot.idx}-t.jpg`) },
    ]);
    await mapBounded(shots, RESIZE_CONCURRENCY, (shot) =>
      resize(
        frameFile(dir, slug, shot.idx),
        join(out, `${shot.idx}.jpg`),
        join(out, `${shot.idx}-t.jpg`),
      ),
    );

    const current = new Set(shots.map((shot) => shot.idx));
    const stale = (await cloud.publishedFrames(slug)).filter(
      (idx) => !current.has(idx),
    );
    const live = await cloud.publishedVectors(slug);
    const stamped = await orphanedVectors(cloud, slug);
    const key = vectorsKey(slug, crypto.randomUUID());
    await cloud.putObjects(
      frames.map((frame) => ({ ...frame, contentType: "image/jpeg" })),
    );
    await cloud.executeSql(publishSql(film, shots));
    await cloud.putObjects([
      { key, file: localVectors, contentType: "application/octet-stream" },
    ]);
    await cloud.executeSql(publishedVersionSql(slug, Date.now(), key));
    const kept = new Set([key, live.current]);
    const retired = [
      ...new Set(
        [live.prior, ...stamped].filter(
          (candidate): candidate is string =>
            candidate !== null && !kept.has(candidate),
        ),
      ),
    ];
    await mapBounded(retired, UPLOAD_CONCURRENCY, (retiredKey) =>
      cloud.deleteObject(retiredKey),
    );
    try {
      await mapBounded(
        stale.flatMap((idx) => [frameKey(slug, idx), thumbKey(slug, idx)]),
        UPLOAD_CONCURRENCY,
        (staleKey) => cloud.deleteObject(staleKey),
      );
    } catch (error) {
      throw new Error(
        `${slug} is published as ${key}, but ${stale.length} stale frames stay in R2: ${reason(error)}; publish it again to clean them up`,
        { cause: error },
      );
    }

    return {
      film: slug,
      shots: shots.length,
      captions: shots.filter((shot) => shot.caption !== null).length,
      frames: frames.length,
      vectorsKey: key,
      vectorBytes: Bun.file(localVectors).size,
      seconds: (performance.now() - started) / 1000,
    };
  } finally {
    db.close();
    if (sized !== undefined) await rm(sized, { recursive: true, force: true });
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
