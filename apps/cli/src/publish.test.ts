import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DDL,
  encodeVectors,
  type FilmVectors,
  vectorsKey,
} from "@framesearch/schema";
import type { Cloud, PublishedVectors } from "./cloud.ts";
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
  live: PublishedVectors = { current: null, prior: null },
  stamped: readonly string[] = [],
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
    publishedVectors: async () => live,
    vectorsFiles: async () => [...stamped],
  };
  return { calls, cloud, sql };
}

function frameKeys(shots: readonly StoredShot[]): string {
  return shots.map((shot) => `frames/${SLUG}/${shot.idx}.jpg`).join(",");
}

const PUBLISHED_KEY = new RegExp(`^vectors/${SLUG}-[0-9a-f-]{36}\\.bin$`);

function withStamps(calls: readonly string[]): string[] {
  return calls.map((call) =>
    call.replace(
      new RegExp(`${SLUG}-[0-9a-f-]{36}\\.bin`, "g"),
      `${SLUG}-<stamp>.bin`,
    ),
  );
}

interface PublishedSeed {
  prior: string | null;
  vectors: string | null;
  version: number;
}

function publishedRow(
  statements: string,
  seed: PublishedSeed = { prior: null, vectors: null, version: 4 },
): PublishedSeed | null {
  const db = new Database(":memory:");
  for (const statement of DDL) db.exec(statement);
  db.prepare(
    `INSERT INTO published (film, version, vectors_key, prior_vectors_key) VALUES ('${SLUG}', ?1, ?2, ?3)`,
  ).run(seed.version, seed.vectors, seed.prior);
  db.exec(statements);
  const row = db
    .query<
      { prior: string | null; vectors: string | null; version: number },
      []
    >(
      "SELECT vectors_key AS vectors, prior_vectors_key AS prior, version FROM published",
    )
    .get();
  db.close();
  return row;
}

describe("publish", () => {
  test("uploads the frames, the rows, the vectors, then the version", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    writeVectors(dir, vectorsFor(shots));
    writeFrames(dir, shots);
    const { cloud, calls } = fakeCloud([]);
    const report = await publishFilm(SLUG, { dataDir: dir, cloud });
    expect(report.vectorsKey).toMatch(PUBLISHED_KEY);
    expect(withStamps(calls)).toEqual([
      `put ${frameKeys(shots)}`,
      "rows",
      `put vectors/${SLUG}-<stamp>.bin`,
      "version",
    ]);
  });

  test("records the uploaded key beside the version in a single statement", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    writeVectors(dir, vectorsFor(shots));
    writeFrames(dir, shots);
    const { cloud, sql } = fakeCloud([]);
    const report = await publishFilm(SLUG, { dataDir: dir, cloud });
    const writes = sql.filter((statements) =>
      statements.includes("INSERT INTO published"),
    );
    expect(writes.length).toBe(1);
    const statements = statementsOf(writes[0] ?? "");
    expect(statements.length).toBe(1);
    const row = publishedRow(writes[0] ?? "");
    expect(row?.vectors).toBe(report.vectorsKey);
  });

  test("keeps the vectors file the previous publish wrote and deletes the older one", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    writeVectors(dir, vectorsFor(shots));
    writeFrames(dir, shots);
    const previous = vectorsKey(SLUG, "previous-publish");
    const older = vectorsKey(SLUG, "older-publish");
    const { cloud, calls, sql } = fakeCloud([], undefined, {
      current: previous,
      prior: older,
    });
    const report = await publishFilm(SLUG, { dataDir: dir, cloud });
    expect(calls).toContain(`delete ${older}`);
    expect(calls).not.toContain(`delete ${previous}`);
    expect(calls).not.toContain(`delete ${report.vectorsKey}`);
    const writes = sql.filter((statements) =>
      statements.includes("INSERT INTO published"),
    );
    const row = publishedRow(writes[0] ?? "", {
      prior: older,
      vectors: previous,
      version: 4,
    });
    expect(row?.vectors).toBe(report.vectorsKey);
    expect(row?.prior).toBe(previous);
  });

  test("deletes every stamped file of the film that no row names", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    writeVectors(dir, vectorsFor(shots));
    writeFrames(dir, shots);
    const current = vectorsKey(SLUG, "current-publish");
    const crashed = vectorsKey(SLUG, "crashed-publish");
    const old = vectorsKey(SLUG, "old-publish");
    const { cloud, calls } = fakeCloud([], undefined, { current, prior: old }, [
      crashed,
      current,
      old,
    ]);
    const report = await publishFilm(SLUG, { dataDir: dir, cloud });
    expect(calls).toContain(`delete ${crashed}`);
    expect(calls).toContain(`delete ${old}`);
    expect(calls).not.toContain(`delete ${current}`);
    expect(calls).not.toContain(`delete ${report.vectorsKey}`);
  });

  test("keeps the plain file of a film published before the keys as the previous one", async () => {
    const dir = dataDir();
    const shots = seed(dir);
    writeVectors(dir, vectorsFor(shots));
    writeFrames(dir, shots);
    const { cloud, calls, sql } = fakeCloud([]);
    const report = await publishFilm(SLUG, { dataDir: dir, cloud });
    expect(calls).not.toContain(`delete ${vectorsKey(SLUG)}`);
    const writes = sql.filter((statements) =>
      statements.includes("INSERT INTO published"),
    );
    const row = publishedRow(writes[0] ?? "");
    expect(row?.vectors).toBe(report.vectorsKey);
    expect(row?.prior).toBe(vectorsKey(SLUG));
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
    expect(withStamps(calls)).toEqual([
      `put ${frameKeys(shots)}`,
      "rows",
      `put vectors/${SLUG}-<stamp>.bin`,
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
    const failure = publishFilm(SLUG, { dataDir: dir, cloud });
    await expect(failure).rejects.toThrow(
      /is published as vectors\/night-of-the-living-dead-[0-9a-f-]{36}.bin, but 2 stale frames stay in R2: R2 refused the delete; publish it again/,
    );
    expect(withStamps(calls)).toEqual([
      `put ${frameKeys(shots)}`,
      "rows",
      `put vectors/${SLUG}-<stamp>.bin`,
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
  test("deletes the row first, then every vectors file, then the frames", async () => {
    const current = vectorsKey(SLUG, "current-publish");
    const prior = vectorsKey(SLUG, "prior-publish");
    const { cloud, calls, sql } = fakeCloud([0, 1, 2], undefined, {
      current,
      prior,
    });
    const report = await unpublishFilm(SLUG, { dataDir: dataDir(), cloud });
    expect(calls).toEqual([
      "rows",
      `delete vectors/${SLUG}.bin`,
      `delete ${current}`,
      `delete ${prior}`,
      `delete frames/${SLUG}/0.jpg`,
      `delete frames/${SLUG}/1.jpg`,
      `delete frames/${SLUG}/2.jpg`,
    ]);
    expect(report.vectorsKeys).toEqual([`vectors/${SLUG}.bin`, current, prior]);
    const statements = statementsOf(sql[0] ?? "");
    expect(statements[DDL.length]).toBe(
      `DELETE FROM published WHERE film = '${SLUG}'`,
    );
  });

  test("deletes the stamped file a failed publish left behind, with the frames", async () => {
    const current = vectorsKey(SLUG, "current-publish");
    const crashed = vectorsKey(SLUG, "crashed-publish");
    const { cloud, calls } = fakeCloud(
      [0, 1, 2],
      undefined,
      { current, prior: null },
      [crashed, current],
    );
    const report = await unpublishFilm(SLUG, { dataDir: dataDir(), cloud });
    expect(calls).toContain(`delete ${crashed}`);
    expect(report.vectorsKeys).toContain(crashed);
  });

  test("deletes the plain file alone when the row named no other", async () => {
    const { cloud, calls } = fakeCloud([]);
    await unpublishFilm(SLUG, { dataDir: dataDir(), cloud });
    expect(calls).toEqual(["rows", `delete vectors/${SLUG}.bin`]);
  });
});

function statementsOf(batch: string): string[] {
  return batch
    .split(";\n")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
}
