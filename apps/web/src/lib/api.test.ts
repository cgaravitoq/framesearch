import { describe, expect, test } from "bun:test";
import { ApiError, searchShots } from "./api.ts";

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
    await searchShots("fire", "", new AbortController().signal);
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("the search answered instead of failing");
}

describe("searchShots", () => {
  test("retries a busy search and shows the message the API sent", async () => {
    const error = await failure(
      503,
      { error: "Search is busy, try again in a moment" },
      { "retry-after": "2" },
    );
    expect(error.retryable).toBe(true);
    expect(error.message).toBe("Search is busy, try again in a moment");
  });

  test("shows a rate limit without retrying it", async () => {
    const error = await failure(
      429,
      { error: "too many searches from this address, retry in a minute" },
      { "retry-after": "60" },
    );
    expect(error.retryable).toBe(false);
    expect(error.message).toBe(
      "too many searches from this address, retry in a minute",
    );
  });

  test("shows an unavailable search without retrying it", async () => {
    const error = await failure(503, {
      error: "Search is temporarily unavailable",
    });
    expect(error.retryable).toBe(false);
  });
});
