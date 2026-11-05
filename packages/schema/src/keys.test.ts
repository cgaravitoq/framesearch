import { describe, expect, test } from "bun:test";
import { vectorsKey } from "./keys.ts";

describe("vectorsKey", () => {
  test("names the plain file a film published before the keys existed", () => {
    expect(vectorsKey("night-of-the-living-dead")).toBe(
      "vectors/night-of-the-living-dead.bin",
    );
  });

  test("names one file per publish once it carries a stamp", () => {
    expect(vectorsKey("night-of-the-living-dead", "6m1x9a")).toBe(
      "vectors/night-of-the-living-dead-6m1x9a.bin",
    );
  });
});
