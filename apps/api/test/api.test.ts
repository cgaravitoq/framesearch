import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { fakeDb, fakeEnv, fakeR2 } from "./support.ts";

describe("films", () => {
  test("lists the published films ordered by title", async () => {
    const { db } = fakeDb({
      rows: [
        {
          duration: 5760,
          slug: "night-of-the-living-dead",
          title: "Night of the Living Dead",
        },
      ],
    });
    const response = await createApp().request(
      "/api/films",
      {},
      fakeEnv({ DB: db }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      films: [
        {
          duration: 5760,
          slug: "night-of-the-living-dead",
          title: "Night of the Living Dead",
        },
      ],
    });
  });

  test("answers an unknown API path with JSON", async () => {
    const response = await createApp().request("/api/unknown", {}, fakeEnv());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "no route for /api/unknown",
    });
  });
});

describe("frames", () => {
  test("asks R2 for the key the schema builds", async () => {
    const frames = fakeR2();
    const response = await createApp().request(
      "/frames/night-of-the-living-dead/7.jpg",
      {},
      fakeEnv({ FRAMES: frames.bucket }),
    );
    expect(response.status).toBe(404);
    expect(frames.keys).toEqual(["frames/night-of-the-living-dead/7.jpg"]);
  });

  test("refuses a film slug that could escape frames/", async () => {
    const frames = fakeR2();
    const response = await createApp().request(
      "/frames/..%2F..%2Fetc/passwd.jpg",
      {},
      fakeEnv({ FRAMES: frames.bucket }),
    );
    expect(response.status).toBe(400);
    expect(frames.keys).toEqual([]);
  });

  test("refuses a frame index that is not a positive integer", async () => {
    const frames = fakeR2();
    const response = await createApp().request(
      "/frames/night-of-the-living-dead/..%2Fsecret.jpg",
      {},
      fakeEnv({ FRAMES: frames.bucket }),
    );
    expect(response.status).toBe(400);
    expect(frames.keys).toEqual([]);
  });

  test("answers a missing frame with 404", async () => {
    const response = await createApp().request(
      "/frames/night-of-the-living-dead/7.png",
      {},
      fakeEnv(),
    );
    expect(response.status).toBe(404);
  });
});

describe("search parameters", () => {
  test("refuses an empty query", async () => {
    const response = await createApp().request("/api/search?q=", {}, fakeEnv());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "q is empty" });
  });

  test("refuses a query over the length limit", async () => {
    const response = await createApp().request(
      `/api/search?q=${"a".repeat(501)}`,
      {},
      fakeEnv(),
    );
    expect(response.status).toBe(400);
  });

  test("refuses a k outside the range", async () => {
    for (const k of ["0", "61", "abc"]) {
      const response = await createApp().request(
        `/api/search?q=fire&k=${k}`,
        {},
        fakeEnv(),
      );
      expect(response.status).toBe(400);
    }
  });

  test("refuses a film that is not a slug", async () => {
    const response = await createApp().request(
      "/api/search?q=fire&film=..%2F..%2Fetc",
      {},
      fakeEnv(),
    );
    expect(response.status).toBe(400);
  });

  test("answers 503 while the embeddings secrets are missing", async () => {
    const response = await createApp().request(
      "/api/search?q=fire",
      {},
      fakeEnv(),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error:
        "search is unavailable: EMBED_URL, EMBED_API_KEY and EMBED_MODEL are not set",
    });
  });

  test("refuses a similar id that is not a positive integer", async () => {
    for (const id of ["", "abc", "0", "-3"]) {
      const response = await createApp().request(
        `/api/similar?id=${id}`,
        {},
        fakeEnv(),
      );
      expect(response.status).toBe(400);
    }
  });
});
