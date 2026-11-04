import { describe, expect, test } from "bun:test";
import { wrangler } from "./cloud.ts";

describe("wrangler", () => {
  test("runs the npx wrangler@4 the workspace's own wrangler cannot shadow", async () => {
    expect(await wrangler(["--version"])).toMatch(/\b4\.\d+\.\d+/);
  }, 120_000);
});
