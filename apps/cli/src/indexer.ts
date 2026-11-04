import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { encodeVectors, type Film } from "@framesearch/schema";
import { CAPTION_PREFIX, captionImages, MAX_COST_USD } from "./caption.ts";
import { DUPLICATE_THRESHOLD, dedupConsecutive } from "./dedup.ts";
import { embed } from "./embed.ts";
import {
  detectCuts,
  extractFrames,
  midTimes,
  probeDuration,
  type Shot,
  shotAt,
  shotBounds,
} from "./ffmpeg.ts";
import { dataDir, filmFramesDir, vectorsFile } from "./paths.ts";
import { createStore, type NewShot, replaceFilm } from "./store.ts";
import { buildVectors, type VectorSource } from "./vectors.ts";

export interface IndexOptions {
  video: string;
  title: string;
  slug: string;
  dataDir?: string | undefined;
}

export interface IndexReport {
  film: Film;
  detectedShots: number;
  cuts: number;
  kept: number;
  dropped: number;
  captioned: number;
  failedCaptions: number;
  costUsd: number;
  seconds: number;
}

interface Candidate {
  time: number;
  bounds: Shot;
  image: Uint8Array;
  vector: Float32Array;
}

export async function indexFilm(options: IndexOptions): Promise<IndexReport> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (apiKey === "") {
    throw new Error(
      "OPENROUTER_API_KEY is not set; index needs it to caption frames",
    );
  }
  const started = performance.now();
  const { video, title, slug } = options;
  const dir = options.dataDir ?? dataDir();
  await mkdir(dir, { recursive: true });

  const duration = await probeDuration(video);
  const cuts = await detectCuts(video);
  const shots = shotBounds(cuts, duration);
  const times = midTimes(shots);
  if (times.length === 0) throw new Error(`no frames found in ${video}`);

  const scratch = await mkdtemp(join(dir, "tmp-"));
  const db = createStore(dir);
  try {
    const extracted = await extractFrames(video, times, join(scratch, "raw"));
    const images = await Promise.all(
      extracted.map((file) => Bun.file(file).bytes()),
    );
    const frameVectors = await embed(images.map((image) => ({ image })));
    const { kept, dropped } = dedupConsecutive(
      frameVectors,
      DUPLICATE_THRESHOLD,
    );

    const keptDir = join(scratch, "kept");
    await mkdir(keptDir, { recursive: true });
    const candidates: Candidate[] = [];
    for (const index of kept) {
      const image = images[index];
      const time = times[index];
      const vector = frameVectors[index];
      if (image === undefined || time === undefined || vector === undefined) {
        continue;
      }
      await Bun.write(join(keptDir, `${candidates.length}.jpg`), image);
      candidates.push({ time, bounds: shotAt(shots, time), image, vector });
    }
    if (candidates.length === 0) {
      throw new Error(`every frame of ${video} was a near-duplicate`);
    }

    const captionReport = await captionImages(
      candidates.map((candidate) => candidate.image),
      { apiKey, budgetUsd: MAX_COST_USD },
    );
    const captionTexts = captionReport.captions.flatMap((caption) =>
      caption === null ? [] : [{ text: `${CAPTION_PREFIX}${caption.caption}` }],
    );
    const captionVectors = await embed(captionTexts);
    let cursor = 0;
    const captionVectorsByFrame: (Float32Array | null)[] = [];
    for (const caption of captionReport.captions) {
      if (caption === null) {
        captionVectorsByFrame.push(null);
        continue;
      }
      captionVectorsByFrame.push(captionVectors[cursor] ?? null);
      cursor += 1;
    }

    const rows: NewShot[] = candidates.map((candidate, index) => ({
      time: candidate.time,
      shotStart: candidate.bounds.start,
      shotEnd: candidate.bounds.end,
      caption: captionReport.captions[index]?.caption ?? null,
      tags: captionReport.captions[index]?.tags ?? [],
    }));
    const film: Film = { slug, title, duration };

    const filmDir = filmFramesDir(dir, slug);
    await mkdir(dirname(filmDir), { recursive: true });
    await rm(filmDir, { recursive: true, force: true });
    await rename(keptDir, filmDir);

    const stored = replaceFilm(db, film, rows);

    const sources: VectorSource[] = stored.map((shot, index) => {
      const candidate = candidates[index];
      if (candidate === undefined) {
        throw new Error(`shot ${shot.id} lost its frame`);
      }
      return {
        shotId: shot.id,
        frame: candidate.vector,
        caption: captionVectorsByFrame[index] ?? null,
      };
    });
    const encoded = encodeVectors(buildVectors(sources));
    const vectors = join(scratch, "vectors.bin");
    await Bun.write(vectors, encoded);
    const target = vectorsFile(dir, slug);
    await mkdir(join(dir, "vectors"), { recursive: true });
    await rm(target, { force: true });
    await rename(vectors, target);

    return {
      film,
      detectedShots: shots.length,
      cuts: cuts.length,
      kept: stored.length,
      dropped: dropped.length,
      captioned: captionVectorsByFrame.filter((vector) => vector !== null)
        .length,
      failedCaptions: captionReport.failed,
      costUsd: captionReport.costUsd,
      seconds: (performance.now() - started) / 1000,
    };
  } finally {
    db.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
