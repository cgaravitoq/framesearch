import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_DATA_DIR, dataDir } from "./paths.ts";

const configured = process.env.FRAMESEARCH_DATA;

afterEach(() => {
  if (configured === undefined) {
    delete process.env.FRAMESEARCH_DATA;
  } else {
    process.env.FRAMESEARCH_DATA = configured;
  }
});

describe("dataDir", () => {
  test("refuses an empty FRAMESEARCH_DATA instead of writing into the cwd", () => {
    process.env.FRAMESEARCH_DATA = "";
    expect(() => dataDir()).toThrow(/FRAMESEARCH_DATA is set but empty/);
  });

  test("falls back to the default store when the variable is unset", () => {
    delete process.env.FRAMESEARCH_DATA;
    expect(dataDir()).toBe(DEFAULT_DATA_DIR);
  });
});
