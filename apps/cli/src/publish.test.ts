import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeVectors, type FilmVectors } from "@framesearch/schema";
import { vectorsFile } from "./paths.ts";
import { publishFilm } from "./publish.ts";
import { createStore, replaceFilm, type StoredShot } from "./store.ts";

const DIM = 8;
const SLUG = "night-of-the-living-dead";
const TITLE = "Night of the Living Dead";

const scratch = mkdtempSync(join(tmpdir(), "framesearch-publish-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function dataDir(): string {
  return mkdtempSync(join(scratch, "store-"));
}

function seed(dir: string): StoredShot[] {
  const db = createStore(dir);
  try {
    return replaceFilm(db, { slug: SLUG, title: TITLE, duration: 5752.8 }, [
      {
        time: 1,
        shotStart: 0,
        shotEnd: 2,
        caption: "a man in a doorway",
        tags: ["medium", "night", "interior"],
      },
      { time: 3, shotStart: 2, shotEnd: 4, caption: null, tags: [] },
      {
        time: 5,
        shotStart: 4,
        shotEnd: 6,
        caption: "a car on a country road",
        tags: ["wide", "day", "exterior"],
      },
    ]);
  } finally {
    db.close();
  }
}

function values(): Int8Array {
  return Int8Array.from({ length: DIM }, (_, at) => at + 1);
}

function vectorsFor(shots: readonly StoredShot[]): FilmVectors {
  return {
    dim: DIM,
    frames: shots.map((shot) => ({ shotId: shot.id, values: values() })),
    captions: shots
      .filter((shot) => shot.caption !== null)
      .map((shot) => ({ shotId: shot.id, values: values() })),
  };
}

function writeVectors(dir: string, vectors: FilmVectors): void {
  mkdirSync(join(dir, "vectors"), { recursive: true });
  writeFileSync(vectorsFile(dir, SLUG), encodeVectors(vectors));
}

describe("publish", () => {
  test("refuses a store whose vectors file lost a frame", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    const vectors = vectorsFor(shots);
    writeVectors(dir, { ...vectors, frames: vectors.frames.slice(1) });
    await expect(publishFilm(SLUG, { dataDir: dir })).rejects.toThrow(
      /does not match the film rows: 1 frame rows have no vector/,
    );
  });

  test("refuses a vectors file that carries an extra caption", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    const vectors = vectorsFor(shots);
    const uncaptioned = shots[1];
    if (uncaptioned === undefined) throw new Error("fixture lost its shot");
    writeVectors(dir, {
      ...vectors,
      captions: [
        ...vectors.captions,
        { shotId: uncaptioned.id, values: values() },
      ],
    });
    await expect(publishFilm(SLUG, { dataDir: dir })).rejects.toThrow(
      /1 caption vectors point at no row/,
    );
  });

  test("refuses a vectors file that repeats a frame", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    const vectors = vectorsFor(shots);
    const [first] = vectors.frames;
    if (first === undefined) throw new Error("fixture lost its frame vectors");
    writeVectors(dir, { ...vectors, frames: [...vectors.frames, first] });
    await expect(publishFilm(SLUG, { dataDir: dir })).rejects.toThrow(
      /frame shot .* appears twice/,
    );
  });

  test("stops before uploading when the store holds no vectors file", async () => {
    const dir = dataDir();
    seed(dir);
    await expect(publishFilm(SLUG, { dataDir: dir })).rejects.toThrow(
      /no vectors file/,
    );
  });

  test("stops before uploading when frames are missing on disk", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    writeVectors(dir, vectorsFor(shots));
    await expect(publishFilm(SLUG, { dataDir: dir })).rejects.toThrow(
      /3 frames are missing from the local store/,
    );
  });

  test("refuses a film the store does not hold", async () => {
    const dir = dataDir();
    seed(dir);
    await expect(publishFilm("nosferatu", { dataDir: dir })).rejects.toThrow(
      /not in the local store/,
    );
  });

  test("refuses a slug that could escape the store", async () => {
    const dir = dataDir();
    seed(dir);
    await expect(publishFilm("../etc", { dataDir: dir })).rejects.toThrow(
      /film must be a lowercase slug/,
    );
  });
});
