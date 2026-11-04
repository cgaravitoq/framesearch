import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { fakeDb, fakeEnv, fakeR2, fakeRateLimit } from "./support.ts";

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

describe("rate limit", () => {
  test("answers 429 once the per-IP budget is spent", async () => {
    const { db, queries } = fakeDb();
    const env = fakeEnv({
      DB: db,
      SEARCH_RATE_LIMIT: fakeRateLimit(false),
    });
    for (const path of ["/api/search?q=fire", "/api/similar?id=7"]) {
      const response = await createApp().request(path, {}, env);
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("60");
    }
    expect(queries).toEqual([]);
  });
});

const IP = "203.0.113.9";

function logRequest(
  path: string,
  body: string,
  contentType = "application/json",
) {
  return createApp().request(
    path,
    {
      body,
      headers: { "cf-connecting-ip": IP, "content-type": contentType },
      method: "POST",
    },
    fakeEnv(),
  );
}

describe("log routes", () => {
  test("refuse a body that is not application/json", async () => {
    const response = await logRequest(
      "/api/log/search",
      '{"query":"fire"}',
      "text/plain",
    );
    expect(response.status).toBe(415);
  });

  test("refuse a body that is not a JSON object", async () => {
    for (const body of ["[1,2]", "not json", '"fire"']) {
      const response = await logRequest("/api/log/search", body);
      expect(response.status).toBe(400);
    }
  });

  test("refuse a body over the size limit", async () => {
    const response = await logRequest(
      "/api/log/search",
      JSON.stringify({ query: "fire", shotIds: Array(5000).fill(1) }),
    );
    expect(response.status).toBe(413);
  });

  test("record the query, film and shots without the address", async () => {
    const { db, queries } = fakeDb({ lastRowId: 42 });
    const response = await createApp().request(
      "/api/log/search",
      {
        body: JSON.stringify({
          film: "night-of-the-living-dead",
          query: "graveyard at night",
          shotIds: [11, 22],
        }),
        headers: { "cf-connecting-ip": IP, "content-type": "application/json" },
        method: "POST",
      },
      fakeEnv({ DB: db }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 42, logged: true });
    const [insert] = queries;
    expect(insert?.args.slice(0, 3)).toEqual([
      "graveyard at night",
      "night-of-the-living-dead",
      JSON.stringify([11, 22]),
    ]);
    expect(insert?.args).not.toContain(IP);
  });

  test("record a click with the rank the search returned", async () => {
    const { db, queries } = fakeDb({
      rows: [{ shot_ids: JSON.stringify([11, 22, 33]) }],
    });
    const response = await createApp().request(
      "/api/log/click",
      {
        body: JSON.stringify({ searchId: 42, shotId: 22 }),
        headers: { "cf-connecting-ip": IP, "content-type": "application/json" },
        method: "POST",
      },
      fakeEnv({ DB: db }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: null, logged: true, rank: 2 });
    const insert = queries.find((query) =>
      query.sql.includes("INSERT INTO search_click"),
    );
    expect(insert?.args.slice(0, 3)).toEqual([42, 22, 2]);
    expect(insert?.args).not.toContain(IP);
  });

  test("refuse a click without a search id", async () => {
    const response = await logRequest("/api/log/click", '{"shotId":22}');
    expect(response.status).toBe(400);
  });
});
