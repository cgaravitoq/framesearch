import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DDL, encodeVectors, type FilmVectors } from "@framesearch/schema";
import type { Cloud } from "./cloud.ts";
import { frameFile, vectorsFile } from "./paths.ts";
import { publishFilm } from "./publish.ts";
import { createStore, replaceFilm, type StoredShot } from "./store.ts";
import { unpublishFilm } from "./unpublish.ts";

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

function writeFrames(dir: string, shots: readonly StoredShot[]): void {
  mkdirSync(join(dir, "frames", SLUG), { recursive: true });
  for (const shot of shots) writeFileSync(frameFile(dir, SLUG, shot.idx), "");
}

function fakeCloud(
  published: number[],
  failAt?: "rows" | "stale",
): { cloud: Cloud; calls: string[]; sql: string[] } {
  const calls: string[] = [];
  const sql: string[] = [];
  const cloud: Cloud = {
    putObjects: async (objects) => {
      calls.push(`put ${objects.map((object) => object.key).join(",")}`);
    },
    deleteObject: async (key) => {
      calls.push(`delete ${key}`);
      if (failAt === "stale") throw new Error("R2 refused the delete");
    },
    executeSql: async (statements) => {
      sql.push(statements);
      if (failAt === "rows" && statements.includes("INSERT INTO films")) {
        throw new Error("D1 refused the batch");
      }
      calls.push(
        statements.includes("INSERT INTO published") ? "version" : "rows",
      );
    },
    publishedFrames: async () => published,
  };
  return { calls, cloud, sql };
}

function frameKeys(shots: readonly StoredShot[]): string {
  return shots.map((shot) => `frames/${SLUG}/${shot.idx}.jpg`).join(",");
}

describe("publish", () => {
  test("uploads the frames, the rows, the vectors, then the version", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    writeVectors(dir, vectorsFor(shots));
    writeFrames(dir, shots);
    const { cloud, calls } = fakeCloud([]);
    await publishFilm(SLUG, { dataDir: dir, cloud });
    expect(calls).toEqual([
      `put ${frameKeys(shots)}`,
      "rows",
      `put vectors/${SLUG}.bin`,
      "version",
    ]);
  });

  test("keeps the published version rising on a republish of the same rows", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    writeVectors(dir, vectorsFor(shots));
    writeFrames(dir, shots);
    const { cloud, sql } = fakeCloud([]);
    await publishFilm(SLUG, { dataDir: dir, cloud });
    await publishFilm(SLUG, { dataDir: dir, cloud });
    const versions = sql.filter((statements) =>
      statements.includes("INSERT INTO published"),
    );
    expect(versions.length).toBe(2);
    const db = new Database(":memory:");
    for (const statement of DDL) db.exec(statement);
    const read = (): number =>
      db
        .query<{ version: number }, [string]>(
          "SELECT version FROM published WHERE film = ?1",
        )
        .get(SLUG)?.version ?? 0;
    const seen: number[] = [];
    for (const statement of versions) {
      db.exec(statement);
      seen.push(read());
    }
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[1]).toBeGreaterThan(seen[0] ?? 0);
  });

  test("leaves no vectors behind when the rows fail to land", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    writeVectors(dir, vectorsFor(shots));
    writeFrames(dir, shots);
    const { cloud, calls } = fakeCloud([], "rows");
    await expect(publishFilm(SLUG, { dataDir: dir, cloud })).rejects.toThrow(
      /D1 refused the batch/,
    );
    expect(calls).toEqual([`put ${frameKeys(shots)}`]);
  });

  test("keeps the frames the published rows still show when the rows fail", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    writeVectors(dir, vectorsFor(shots));
    writeFrames(dir, shots);
    const { cloud, calls } = fakeCloud([0, 1, 2, 3, 4], "rows");
    await expect(publishFilm(SLUG, { dataDir: dir, cloud })).rejects.toThrow(
      /D1 refused the batch/,
    );
    expect(calls).toEqual([`put ${frameKeys(shots)}`]);
  });

  test("removes the frames an earlier, longer cut left in R2 after the version lands", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    writeVectors(dir, vectorsFor(shots));
    writeFrames(dir, shots);
    const { cloud, calls } = fakeCloud([0, 1, 2, 3, 4]);
    await publishFilm(SLUG, { dataDir: dir, cloud });
    expect(calls).toEqual([
      `put ${frameKeys(shots)}`,
      "rows",
      `put vectors/${SLUG}.bin`,
      "version",
      `delete frames/${SLUG}/3.jpg`,
      `delete frames/${SLUG}/4.jpg`,
    ]);
  });

  test("leaves the new version live when the stale-frame cleanup fails", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    writeVectors(dir, vectorsFor(shots));
    writeFrames(dir, shots);
    const { cloud, calls } = fakeCloud([0, 1, 2, 3, 4], "stale");
    await expect(publishFilm(SLUG, { dataDir: dir, cloud })).rejects.toThrow(
      /is published as vectors\/night-of-the-living-dead.bin, but 2 stale frames stay in R2: R2 refused the delete; publish it again/,
    );
    expect(calls).toEqual([
      `put ${frameKeys(shots)}`,
      "rows",
      `put vectors/${SLUG}.bin`,
      "version",
      `delete frames/${SLUG}/3.jpg`,
      `delete frames/${SLUG}/4.jpg`,
    ]);
  });

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

describe("unpublish", () => {
  test("removes the vectors, then the rows, then the frames", async () => {
    const { cloud, calls, sql } = fakeCloud([0, 1, 2]);
    await unpublishFilm(SLUG, { dataDir: dataDir(), cloud });
    expect(calls).toEqual([
      `delete vectors/${SLUG}.bin`,
      "rows",
      `delete frames/${SLUG}/0.jpg`,
      `delete frames/${SLUG}/1.jpg`,
      `delete frames/${SLUG}/2.jpg`,
    ]);
    expect(sql[0]).toContain(`DELETE FROM published WHERE film = '${SLUG}'`);
  });
});
