import { describe, expect, test } from "bun:test";
import { ApiError, searchShots, serverTotal } from "./api.ts";

function answer(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      headers,
      status,
    })) as unknown as typeof fetch;
}

async function failure(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<ApiError> {
  answer(status, body, headers);
  try {
    await searchShots("fire", 12, new AbortController().signal);
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("the search answered instead of failing");
}

describe("searchShots", () => {
  test("tells a busy model apart and asks for a retry", async () => {
    const error = await failure(
      503,
      { error: "Search is busy, try again in a moment" },
      { "retry-after": "2" },
    );
    expect(error.busy).toBe(true);
    expect(error.message).toBe(
      "The search model is waking up. Retry in a few seconds.",
    );
  });

  test("treats a rate limit as busy", async () => {
    const error = await failure(
      429,
      { error: "too many searches from this address, retry in a minute" },
      { "retry-after": "60" },
    );
    expect(error.busy).toBe(true);
    expect(error.message).toBe(
      "Too many searches from this address. Retry in a minute.",
    );
  });

  test("shows an unavailable search with the message the API sent", async () => {
    const error = await failure(503, {
      error: "Search is temporarily unavailable",
    });
    expect(error.busy).toBe(false);
    expect(error.message).toBe("Search is temporarily unavailable");
  });

  test("reads the server total from the timing header", async () => {
    answer(
      200,
      { query: "fire", film: null, results: [] },
      {
        "server-timing": 'd1;dur=68,embed;dur=354;desc="primary",total;dur=411',
      },
    );
    const found = await searchShots("fire", 12, new AbortController().signal);
    expect(found.serverMs).toBe(411);
    expect(serverTotal(null)).toBeNull();
  });
});
