import { existsSync } from "node:fs";
import { decodeVectors, frameKey, vectorsKey } from "@framesearch/schema";
import {
  executeSql,
  mapBounded,
  putObject,
  UPLOAD_CONCURRENCY,
} from "./cloud.ts";
import { dataDir, frameFile, vectorsFile } from "./paths.ts";
import { publishSql } from "./sql.ts";
import { openStore, readFilm, readShots } from "./store.ts";
import { parseFilmArg, unwrap } from "./validate.ts";
import { assertVectorsMatch } from "./vectors.ts";

export interface PublishOptions {
  dataDir?: string | undefined;
}

export interface PublishReport {
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
  const db = openStore(dir);
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

    const frames = shots.map((shot) => ({
      key: frameKey(slug, shot.idx),
      file: frameFile(dir, slug, shot.idx),
    }));
    const missing = frames.filter((frame) => !existsSync(frame.file));
    const firstMissing = missing[0];
    if (firstMissing !== undefined) {
      throw new Error(
        `${missing.length} frames are missing from the local store, first ${firstMissing.file}`,
      );
    }

    await mapBounded(frames, UPLOAD_CONCURRENCY, (frame) =>
      putObject(frame.key, frame.file, "image/jpeg"),
    );
    const key = vectorsKey(slug);
    await putObject(key, localVectors, "application/octet-stream");
    await executeSql(publishSql(film, shots));

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
  }
}
