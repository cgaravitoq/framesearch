import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { readFlags } from "../src/flags.ts";
import { fakeEnv } from "./support.ts";

describe("flags", () => {
  test("turns on the flags the deployment names", () => {
    expect(readFlags({ SEARCH_LOG: true })).toEqual({ searchLog: true });
  });

  test("turns off every flag the deployment leaves out or names otherwise", () => {
    expect(readFlags({})).toEqual({ searchLog: false });
    expect(readFlags({ SEARCH_LOG: false })).toEqual({ searchLog: false });
    expect(readFlags({ SEARCH_LOG: "true" })).toEqual({ searchLog: false });
    expect(readFlags({ FUTURE_FLAG: true })).toEqual({ searchLog: false });
  });

  test("exposes booleans to the web and nothing else", async () => {
    const response = await createApp().request(
      "/api/flags",
      {},
      fakeEnv({ SEARCH_LOG: true }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ searchLog: true });
  });

  test("refuses the search log when its flag is off", async () => {
    const response = await createApp().request(
      "/api/log/search",
      {
        body: JSON.stringify({ film: null, query: "a cemetery", shotIds: [] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      fakeEnv({ SEARCH_LOG: false }),
    );
    expect(response.status).toBe(404);
  });
});
