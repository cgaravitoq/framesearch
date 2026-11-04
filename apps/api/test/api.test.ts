import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { fakeDb, fakeEnv } from "./support.ts";

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
