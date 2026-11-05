import { describe, expect, spyOn, test } from "bun:test";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import {
  encodeVectors,
  type SearchReply,
  vectorsKey,
} from "@framesearch/schema";
import { createApp } from "../src/app.ts";
import type { Env } from "../src/env.ts";
import {
  type FakeSession,
  fakeDb,
  fakeEmbedder,
  fakeEnv,
  fakeR2,
  fakeRateLimit,
  type Query,
  withFakeTime,
} from "./support.ts";

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

  test("answers an unhandled failure without its error", async () => {
    const db = {
      prepare: () => {
        throw new Error(LEAK);
      },
    } as unknown as D1Database;
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await createApp().request(
        "/api/films",
        {},
        fakeEnv({ DB: db }),
      );
      expect(response.status).toBe(500);
      expect(await response.text()).toBe(
        JSON.stringify({ error: "Something went wrong" }),
      );
    } finally {
      logged.mockRestore();
    }
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

  test("serves the first frame of a film, index zero", async () => {
    const frames = fakeR2();
    const response = await createApp().request(
      "/frames/night-of-the-living-dead/0.jpg",
      {},
      fakeEnv({ FRAMES: frames.bucket }),
    );
    expect(response.status).toBe(404);
    expect(frames.keys).toEqual(["frames/night-of-the-living-dead/0.jpg"]);
  });

  test("refuses a frame index with a leading zero", async () => {
    const frames = fakeR2();
    const response = await createApp().request(
      "/frames/night-of-the-living-dead/07.jpg",
      {},
      fakeEnv({ FRAMES: frames.bucket }),
    );
    expect(response.status).toBe(400);
    expect(frames.keys).toEqual([]);
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

  test("refuses a frame index that is not a non-negative integer", async () => {
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

  test("answers 503 without naming any secret", async () => {
    const response = await createApp().request(
      "/api/search?q=fire",
      {},
      fakeEnv(),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Search is temporarily unavailable",
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

describe("search cache", () => {
  test("serves a repeated query from memory, whatever its case and spacing", async () => {
    const fixture = searchFixture("night-of-the-living-dead", 1);
    const embeddings = stubEmbeddings();
    try {
      const first = await createApp().request(
        "/api/search?q=fire&k=1",
        {},
        fixture.env,
      );
      expect(first.status).toBe(200);
      expect(first.headers.get("x-cache")).toBe("miss");
      const second = await createApp().request(
        "/api/search?q=%20%20FIRE%20&k=1",
        {},
        fixture.env,
      );
      expect(second.status).toBe(200);
      expect(second.headers.get("x-cache")).toBe("hit");
      const reply = (await second.json()) as SearchReply;
      expect(reply.query).toBe("FIRE");
      expect(reply.results.map((hit) => hit.shotId)).toEqual([1]);
      expect(embeddings.calls()).toBe(1);
    } finally {
      embeddings.restore();
    }
  });

  test("drops the cached results and reloads the vectors after a republish", async () => {
    const fixture = searchFixture("dawn-of-the-dead", 5);
    const embeddings = stubEmbeddings();
    try {
      const first = await createApp().request(
        "/api/search?q=graveyard&k=1",
        {},
        fixture.env,
      );
      expect(first.headers.get("x-cache")).toBe("miss");
      fixture.setVersion(6);
      const second = await createApp().request(
        "/api/search?q=graveyard&k=1",
        {},
        fixture.env,
      );
      expect(second.status).toBe(200);
      expect(second.headers.get("x-cache")).toBe("miss");
      expect(embeddings.calls()).toBe(2);
      expect(fixture.vectorsReads()).toBe(2);
    } finally {
      embeddings.restore();
    }
  });

  test("answers a remote embeddings 503 with the generic 502, not busy", async () => {
    const fixture = searchFixture("the-terror", 1);
    const spy = spyOn(globalThis, "fetch").mockImplementation(
      (async () =>
        new Response("upstream overloaded", {
          status: 503,
        })) as unknown as typeof fetch,
    );
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await createApp().request(
        "/api/search?q=castle",
        {},
        fixture.env,
      );
      expect(response.status).toBe(502);
      expect(response.headers.get("retry-after")).toBeNull();
      expect(await response.json()).toEqual({
        error: "Search is temporarily unavailable",
      });
    } finally {
      spy.mockRestore();
      logged.mockRestore();
    }
  });

  test("answers an embedding failure with a generic 502", async () => {
    const fixture = searchFixture("the-terror", 1);
    const spy = spyOn(globalThis, "fetch").mockImplementation((async () => {
      throw new Error(LEAK);
    }) as unknown as typeof fetch);
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await createApp().request(
        "/api/search?q=castle",
        {},
        fixture.env,
      );
      expect(response.status).toBe(502);
      expect(await response.text()).toBe(
        JSON.stringify({ error: "Search is temporarily unavailable" }),
      );
    } finally {
      spy.mockRestore();
      logged.mockRestore();
    }
  });

  test("ignores an R2 write that leaves the published version alone", async () => {
    const fixture = searchFixture("white-zombie", 7);
    const embeddings = stubEmbeddings();
    try {
      const first = await createApp().request(
        "/api/search?q=mill&k=1",
        {},
        fixture.env,
      );
      expect(first.headers.get("x-cache")).toBe("miss");
      fixture.republishVectors();
      const second = await createApp().request(
        "/api/search?q=mill&k=1",
        {},
        fixture.env,
      );
      expect(second.status).toBe(200);
      expect(second.headers.get("x-cache")).toBe("hit");
      expect(fixture.vectorsReads()).toBe(1);
      fixture.setVersion(8);
      const third = await createApp().request(
        "/api/search?q=mill&k=1",
        {},
        fixture.env,
      );
      expect(third.headers.get("x-cache")).toBe("miss");
      expect(fixture.vectorsReads()).toBe(2);
    } finally {
      embeddings.restore();
    }
  });
});

describe("search availability", () => {
  test("reads the published version once per request and heads no R2 object", async () => {
    const fixture = searchFixture("night-of-the-living-dead", 4);
    const embeddings = stubEmbeddings();
    try {
      const searched = await createApp().request(
        "/api/search?q=fire&k=1",
        {},
        fixture.env,
      );
      expect(searched.status).toBe(200);
      expect(fixture.publishedReads()).toBe(1);
      const similar = await createApp().request(
        "/api/similar?id=1",
        {},
        fixture.env,
      );
      expect(similar.status).toBe(200);
      expect(fixture.publishedReads()).toBe(2);
      expect(fixture.heads()).toEqual([]);
    } finally {
      embeddings.restore();
    }
  });

  test("answers from the embedder container when no EMBED_URL is set", async () => {
    const fixture = searchFixture("white-zombie", 1);
    const embedder = fakeEmbedder({ vector: [1, 0] });
    const env: Env = {
      ...fixture.env,
      EMBEDDER: embedder.namespace,
      EMBED_API_KEY: undefined,
      EMBED_MODEL: undefined,
      EMBED_URL: undefined,
    };
    const response = await createApp().request(
      "/api/search?q=a%20zombie%20at%20the%20mill",
      {},
      env,
    );
    expect(response.status).toBe(200);
    const reply = (await response.json()) as SearchReply;
    expect(reply.results.map((hit) => hit.shotId)).toEqual([1, 2]);
    expect(embedder.calls.map((call) => call.instance)).toEqual(["primary"]);
  });

  test("answers a busy embedder with a 503 the user can retry", async () => {
    const fixture = searchFixture("white-zombie", 2);
    const embedder = fakeEmbedder({ answer: "busy", vector: [1, 0] });
    const env: Env = {
      ...fixture.env,
      EMBEDDER: embedder.namespace,
      EMBED_API_KEY: undefined,
      EMBED_MODEL: undefined,
      EMBED_URL: undefined,
    };
    const response = await withFakeTime(async () =>
      createApp().request(
        "/api/search?q=a%20busy%20zombie%20at%20the%20mill",
        {},
        env,
      ),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(await response.json()).toEqual({
      error: "Search is busy, try again in a moment",
    });
  });
});

describe("vectors snapshot", () => {
  test("reads the vectors file its own published row names", async () => {
    const film = "dawn-of-the-dead";
    const fixture = searchFixture(film, 4);
    fixture.setVectorsKey(vectorsKey(film, FIRST_PUBLISH));
    const embeddings = stubEmbeddings();
    try {
      const response = await createApp().request(
        "/api/search?q=graveyard&k=1",
        {},
        fixture.env,
      );
      expect(response.status).toBe(200);
      const reply = (await response.json()) as SearchReply;
      expect(reply.results.map((hit) => hit.shotId)).toEqual([2]);
      expect(fixture.vectorsObjects()).toEqual([
        vectorsKey(film, FIRST_PUBLISH),
      ]);
    } finally {
      embeddings.restore();
    }
  });

  test("falls back to the plain file when the row names none", async () => {
    const film = "day-of-the-dead";
    const fixture = searchFixture(film, 2);
    const embeddings = stubEmbeddings();
    try {
      const response = await createApp().request(
        "/api/search?q=mall&k=1",
        {},
        fixture.env,
      );
      expect(response.status).toBe(200);
      const reply = (await response.json()) as SearchReply;
      expect(reply.results.map((hit) => hit.shotId)).toEqual([1]);
      expect(fixture.vectorsObjects()).toEqual([vectorsKey(film)]);
    } finally {
      embeddings.restore();
    }
  });

  test("reloads the vectors when the key moves and the version stands", async () => {
    const film = "land-of-the-dead";
    const fixture = searchFixture(film, 9);
    fixture.setVectorsKey(vectorsKey(film, SECOND_PUBLISH));
    const embeddings = stubEmbeddings();
    try {
      const first = await createApp().request(
        "/api/search?q=bunker&k=1",
        {},
        fixture.env,
      );
      const firstReply = (await first.json()) as SearchReply;
      expect(firstReply.results.map((hit) => hit.shotId)).toEqual([1]);
      fixture.setVectorsKey(vectorsKey(film, FIRST_PUBLISH));
      const second = await createApp().request(
        "/api/search?q=bunker&k=1",
        {},
        fixture.env,
      );
      expect(second.headers.get("x-cache")).toBe("miss");
      const secondReply = (await second.json()) as SearchReply;
      expect(secondReply.results.map((hit) => hit.shotId)).toEqual([2]);
      expect(fixture.vectorsReads()).toBe(2);
    } finally {
      embeddings.restore();
    }
  });
});

describe("server timing", () => {
  test("splits a search into reads, embedding and total without the query", async () => {
    const fixture = searchFixture("white-zombie", 1);
    const embedder = fakeEmbedder({ containerMs: 12, vector: [1, 0] });
    const env: Env = {
      ...fixture.env,
      EMBEDDER: embedder.namespace,
      EMBED_API_KEY: undefined,
      EMBED_MODEL: undefined,
      EMBED_URL: undefined,
    };
    const response = await createApp().request(
      "/api/search?q=a%20cellar%20full%20of%20zombies",
      {},
      env,
    );
    expect(response.status).toBe(200);
    const header = response.headers.get("server-timing") ?? "";
    expect(wellFormed(header)).toBe(true);
    expect(phases(header).map((phase) => phase.name)).toEqual([
      "d1",
      "embed",
      "total",
    ]);
    expect(header).toContain('desc="primary busy=0 container=12"');
    expect(header).not.toContain("cellar");
  });

  test("names every instance it tried and how many were busy", async () => {
    const fixture = searchFixture("white-zombie", 1);
    const embedder = fakeEmbedder({
      answer: (instance) => (instance === "primary" ? "busy" : 200),
      vector: [1, 0],
    });
    const env: Env = {
      ...fixture.env,
      EMBEDDER: embedder.namespace,
      EMBED_API_KEY: undefined,
      EMBED_MODEL: undefined,
      EMBED_URL: undefined,
    };
    const response = await createApp().request(
      "/api/search?q=a%20zombie%20in%20the%20cellar%20at%20dusk",
      {},
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing") ?? "").toContain(
      'desc="primary>overflow-1 busy=1',
    );
  });

  test("splits a similar reply into reads and total", async () => {
    const fixture = searchFixture("night-of-the-living-dead", 4);
    const response = await createApp().request(
      "/api/similar?id=1",
      {},
      fixture.env,
    );
    expect(response.status).toBe(200);
    const header = response.headers.get("server-timing") ?? "";
    expect(wellFormed(header)).toBe(true);
    expect(phases(header).map((phase) => phase.name)).toEqual([
      "d1",
      "embed",
      "total",
    ]);
    expect(header).toContain('embed;dur=0;desc="none"');
  });
});

describe("read sessions", () => {
  test("reads a search through one session and never the primary", async () => {
    const fixture = searchFixture("night-of-the-living-dead", 4);
    const embeddings = stubEmbeddings();
    try {
      const response = await createApp().request(
        "/api/search?q=cellar&k=2",
        {},
        fixture.env,
      );
      expect(response.status).toBe(200);
      const [session] = fixture.sessions();
      expect(fixture.sessions().length).toBe(1);
      expect(session?.constraint).toBeUndefined();
      expect(session?.statements.some((sql) => sql.includes(PUBLISHED))).toBe(
        true,
      );
      expect(session?.queries.length).toBeGreaterThan(0);
      expect(fixture.primaryQueries()).toEqual([]);
    } finally {
      embeddings.restore();
    }
  });

  test("reads the films list through one session", async () => {
    const { db, sessions } = fakeDb();
    const response = await createApp().request(
      "/api/films",
      {},
      fakeEnv({ DB: db }),
    );
    expect(response.status).toBe(200);
    expect(sessions.length).toBe(1);
    expect(
      sessions[0]?.statements.some((sql) => sql.includes("FROM films")),
    ).toBe(true);
  });

  test("opens a new session for each request", async () => {
    const fixture = searchFixture("night-of-the-living-dead", 4);
    const embeddings = stubEmbeddings();
    try {
      await createApp().request("/api/search?q=fire&k=1", {}, fixture.env);
      await createApp().request("/api/similar?id=1", {}, fixture.env);
      const sessions = fixture.sessions();
      expect(sessions.length).toBe(2);
      expect(
        sessions[1]?.statements.some((sql) => sql.includes(PUBLISHED)),
      ).toBe(true);
      expect(fixture.primaryQueries()).toEqual([]);
    } finally {
      embeddings.restore();
    }
  });

  test("writes the search log to the primary, outside any session", async () => {
    const { db, queries, sessions } = fakeDb({ lastRowId: 7 });
    const response = await createApp().request(
      "/api/log/search",
      {
        body: JSON.stringify({ query: "fire" }),
        headers: { "cf-connecting-ip": IP, "content-type": "application/json" },
        method: "POST",
      },
      fakeEnv({ DB: db }),
    );
    expect(response.status).toBe(200);
    expect(sessions).toEqual([]);
    expect(
      queries.filter((query) => query.sql.includes("INSERT INTO search_log"))
        .length,
    ).toBe(1);
  });
});

describe("similar", () => {
  test("answers a failed vector load without its error", async () => {
    const { db } = fakeDb({
      rows: (sql) =>
        sql.includes(PUBLISHED) ? [{ slug: "the-bat", version: 9 }] : [],
    });
    const frames = {
      get: async () => {
        throw new Error(LEAK);
      },
      head: async () => null,
    } as unknown as R2Bucket;
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await createApp().request(
        "/api/similar?id=1",
        {},
        fakeEnv({ DB: db, FRAMES: frames }),
      );
      expect(response.status).toBe(502);
      expect(await response.text()).toBe(
        JSON.stringify({ error: "Something went wrong" }),
      );
    } finally {
      logged.mockRestore();
    }
  });

  test("never answers with another frame of the shot it was asked about", async () => {
    const film = "night-of-the-living-dead";
    const shot = (id: number, shotStart: number, shotEnd: number) => ({
      caption: null,
      film,
      id,
      idx: id - 1,
      shotEnd,
      shotStart,
      tags: "[]",
      time: shotStart,
      title: "Night of the Living Dead",
    });
    const shots = [shot(1, 0, 4), shot(2, 0, 4), shot(3, 4, 9)];
    const { db } = fakeDb({
      rows: (sql) => {
        if (sql.includes(PUBLISHED)) return [{ slug: film, version: 3 }];
        if (sql.includes("sibling")) return [{ id: 1 }, { id: 2 }];
        return shots;
      },
    });
    const frames = fakeR2({
      [vectorsKey(film)]: encodeVectors({
        captions: [],
        dim: 2,
        frames: [
          { shotId: 1, values: Int8Array.from([127, 0]) },
          { shotId: 2, values: Int8Array.from([120, 40]) },
          { shotId: 3, values: Int8Array.from([90, 90]) },
        ],
      }),
    });
    const response = await createApp().request(
      "/api/similar?id=1&k=12",
      {},
      fakeEnv({ DB: db, FRAMES: frames.bucket }),
    );
    expect(response.status).toBe(200);
    const reply = (await response.json()) as {
      shotId: number;
      results: { shotId: number }[];
    };
    expect(reply.shotId).toBe(1);
    expect(reply.results.map((hit) => hit.shotId)).toEqual([3]);
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
const LEAK = "EMBED_API_KEY sk-secret at /srv/framesearch/embeddings.ts";
const PUBLISHED = "LEFT JOIN published";
const CHUNK_BYTES = 4096;
const MAX_CHUNKS = 4;

function chunkedLogRequest(pulls: { count: number }): Request {
  const filler = "a".repeat(CHUNK_BYTES - 12);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls.count += 1;
      controller.enqueue(new TextEncoder().encode(`{"query":"${filler}"}`));
    },
  });
  const init = {
    body,
    headers: { "cf-connecting-ip": IP, "content-type": "application/json" },
    method: "POST",
  } as RequestInit;
  return new Request("http://localhost/api/log/search", init);
}

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

  test("refuse a declared content-length over the limit before reading the body", async () => {
    const response = await createApp().request(
      "/api/log/search",
      {
        body: '{"query":"fire"}',
        headers: {
          "cf-connecting-ip": IP,
          "content-length": "8193",
          "content-type": "application/json",
        },
        method: "POST",
      },
      fakeEnv(),
    );
    expect(response.status).toBe(413);
  });

  test("stop reading a chunked body once it passes the size limit", async () => {
    const pulls = { count: 0 };
    const response = await createApp().request(
      chunkedLogRequest(pulls),
      undefined,
      fakeEnv(),
    );
    expect(response.status).toBe(413);
    expect(pulls.count).toBeLessThan(MAX_CHUNKS);
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

  test("record the rank the visitor saw over the stored one", async () => {
    const { db, queries } = fakeDb({
      rows: [{ shot_ids: JSON.stringify([11, 22, 33]) }],
    });
    const response = await createApp().request(
      "/api/log/click",
      {
        body: JSON.stringify({ rank: 5, searchId: 42, shotId: 22 }),
        headers: { "cf-connecting-ip": IP, "content-type": "application/json" },
        method: "POST",
      },
      fakeEnv({ DB: db }),
    );
    expect(await response.json()).toEqual({ id: null, logged: true, rank: 5 });
    const insert = queries.find((query) =>
      query.sql.includes("INSERT INTO search_click"),
    );
    expect(insert?.args.slice(0, 3)).toEqual([42, 22, 5]);
  });

  test("refuse a click whose rank is not a positive integer", async () => {
    for (const rank of ["0", "-1", "1.5", '"2"', "true"]) {
      const response = await logRequest(
        "/api/log/click",
        `{"searchId":42,"shotId":22,"rank":${rank}}`,
      );
      expect(response.status).toBe(400);
    }
  });

  test("refuse a click without a search id", async () => {
    const response = await logRequest("/api/log/click", '{"shotId":22}');
    expect(response.status).toBe(400);
  });
});

interface SearchFixture {
  env: Env;
  heads: () => string[];
  primaryQueries: () => Query[];
  publishedReads: () => number;
  republishVectors: () => void;
  sessions: () => FakeSession[];
  setVersion: (version: number) => void;
  setVectorsKey: (key: string | null) => void;
  vectorsObjects: () => string[];
  vectorsReads: () => number;
}

const FIRST_PUBLISH = "publish-1";
const SECOND_PUBLISH = "publish-2";

function searchFixture(film: string, version: number): SearchFixture {
  let current = version;
  let currentKey: string | null = null;
  const shots = [
    {
      caption: null,
      film,
      id: 1,
      idx: 1,
      shotEnd: 4,
      shotStart: 0,
      tags: "[]",
      time: 0,
      title: "Night of the Living Dead",
    },
    {
      caption: null,
      film,
      id: 2,
      idx: 2,
      shotEnd: 9,
      shotStart: 4,
      tags: "[]",
      time: 4,
      title: "Night of the Living Dead",
    },
  ];
  const { db, queries, sessions, statements } = fakeDb({
    rows: (sql) => {
      if (sql.includes(PUBLISHED)) {
        return [{ slug: film, vectorsKey: currentKey, version: current }];
      }
      if (sql.includes("bm25")) return [];
      return shots;
    },
  });
  const vectors = encodeVectors({
    captions: [],
    dim: 2,
    frames: [
      { shotId: 1, values: Int8Array.from([127, 0]) },
      { shotId: 2, values: Int8Array.from([0, 127]) },
    ],
  });
  const frames = fakeR2({
    [vectorsKey(film)]: vectors,
    [vectorsKey(film, FIRST_PUBLISH)]: encodeVectors({
      captions: [],
      dim: 2,
      frames: [
        { shotId: 1, values: Int8Array.from([0, 127]) },
        { shotId: 2, values: Int8Array.from([127, 0]) },
      ],
    }),
    [vectorsKey(film, SECOND_PUBLISH)]: vectors,
  });
  return {
    env: fakeEnv({
      DB: db,
      EMBED_API_KEY: "key",
      EMBED_MODEL: "model",
      EMBED_URL: "http://embed.test/v1/embeddings",
      FRAMES: frames.bucket,
    }),
    heads: () => frames.heads,
    primaryQueries: () => queries,
    publishedReads: () =>
      statements.filter((sql) => sql.includes(PUBLISHED)).length,
    republishVectors: () => frames.put(vectorsKey(film), vectors),
    sessions: () => sessions,
    setVersion: (next) => {
      current = next;
    },
    setVectorsKey: (key) => {
      currentKey = key;
    },
    vectorsObjects: () =>
      frames.keys.filter((key) => key.startsWith("vectors/")),
    vectorsReads: () =>
      frames.keys.filter((key) => key.startsWith("vectors/")).length,
  };
}

interface Phase {
  duration: number;
  name: string;
}

function phases(header: string): Phase[] {
  return header.split(",").map((entry) => {
    const [name = "", ...params] = entry.split(";");
    const dur = params.find((param) => param.startsWith("dur=")) ?? "dur=";
    return { duration: Number(dur.slice("dur=".length)), name };
  });
}

function wellFormed(header: string): boolean {
  const entries = header.split(",");
  return (
    entries.length > 0 &&
    entries.every((entry) =>
      /^[a-z][a-z0-9_-]*;dur=[0-9]+(?:\.[0-9]+)?(?:;desc="[^"]*")?$/.test(
        entry,
      ),
    )
  );
}

function stubEmbeddings(): { calls: () => number; restore: () => void } {
  let calls = 0;
  const answer = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const spy = spyOn(globalThis, "fetch").mockImplementation(answer);
  return { calls: () => calls, restore: () => spy.mockRestore() };
}
