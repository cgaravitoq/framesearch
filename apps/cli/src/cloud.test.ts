import { describe, expect, spyOn, test } from "bun:test";
import { vectorsKey } from "@framesearch/schema";
import { vectorsFiles, wrangler } from "./cloud.ts";

const ACCOUNT = "account-1";
const FIRST = vectorsKey("night", "0f0f0f0f-1111-4222-8333-444455556666");
const SECOND = vectorsKey("night", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
const LONGER = vectorsKey("night-2", "0f0f0f0f-1111-4222-8333-444455556666");

describe("wrangler", () => {
  test("runs the npx wrangler@4 the workspace's own wrangler cannot shadow", async () => {
    expect(await wrangler(["--version"])).toMatch(/\b4\.\d+\.\d+/);
  }, 120_000);
});

describe("vectors files", () => {
  test("lists only the stamped files of that exact film, one page at a time", async () => {
    const asked: string[] = [];
    const pages = [
      {
        result: [{ key: FIRST }, { key: LONGER }, { key: vectorsKey("night") }],
        result_info: { cursor: "next-page", is_truncated: true },
      },
      { result: [{ key: SECOND }], result_info: { is_truncated: false } },
    ];
    const spy = spyOn(globalThis, "fetch").mockImplementation((async (
      input: URL,
    ) => {
      asked.push(input.toString());
      const page = pages[asked.length - 1] ?? { result: [] };
      return new Response(JSON.stringify(page), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch);
    const restore = withCredentials();
    try {
      expect(await vectorsFiles("night")).toEqual([FIRST, SECOND]);
      expect(asked.length).toBe(2);
      const first = new URL(asked[0] ?? "");
      expect(first.origin + first.pathname).toBe(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/framesearch/objects`,
      );
      expect(first.searchParams.get("prefix")).toBe("vectors/night-");
      expect(first.searchParams.get("per_page")).toBe("1000");
      expect(first.searchParams.get("cursor")).toBeNull();
      expect(new URL(asked[1] ?? "").searchParams.get("cursor")).toBe(
        "next-page",
      );
    } finally {
      spy.mockRestore();
      restore();
    }
  });

  test("answers a refused page without its body reaching the caller", async () => {
    const spy = spyOn(globalThis, "fetch").mockImplementation(
      (async () =>
        new Response("invalid token", {
          status: 403,
        })) as unknown as typeof fetch,
    );
    const restore = withCredentials();
    try {
      await expect(vectorsFiles("night")).rejects.toThrow(/failed \(403\)/);
    } finally {
      spy.mockRestore();
      restore();
    }
  });
});

function withCredentials(): () => void {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT;
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  return () => {
    if (account === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = account;
    if (token === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = token;
  };
}
