import { describe, expect, test } from "bun:test";
import {
  DEFAULT_K,
  MAX_K,
  MAX_QUERY_LENGTH,
  parseFilmSlug,
  parseK,
  parseQuery,
  parseShotId,
} from "./validation.ts";

const NOT_CANONICAL = ["0x10", "1e3", "01", "+1", "-1", "1.0", " 1"];

describe("parseK", () => {
  test("defaults when absent", () => {
    expect(parseK(null)).toEqual({ ok: true, value: DEFAULT_K });
  });

  test("rejects forms that are not canonical positive integers", () => {
    for (const raw of NOT_CANONICAL) {
      expect(parseK(raw).ok).toBe(false);
    }
  });

  test("rejects integers above the bound", () => {
    expect(parseK(String(MAX_K + 1)).ok).toBe(false);
    expect(parseK(String(MAX_K))).toEqual({ ok: true, value: MAX_K });
  });
});

describe("parseShotId", () => {
  test("rejects forms that are not canonical positive integers", () => {
    for (const raw of NOT_CANONICAL) {
      expect(parseShotId(raw).ok).toBe(false);
    }
  });

  test("accepts a canonical integer", () => {
    expect(parseShotId("42")).toEqual({ ok: true, value: 42 });
  });
});

describe("parseQuery", () => {
  test("rejects an empty query", () => {
    expect(parseQuery("   ").ok).toBe(false);
  });

  test("rejects an oversized query", () => {
    expect(parseQuery("a".repeat(MAX_QUERY_LENGTH + 1)).ok).toBe(false);
  });

  test("trims a bounded query", () => {
    expect(parseQuery("  a man in a doorway  ")).toEqual({
      ok: true,
      value: "a man in a doorway",
    });
  });
});

describe("parseFilmSlug", () => {
  test("accepts a hyphenated lowercase slug", () => {
    expect(parseFilmSlug("night-of-the-living-dead")).toEqual({
      ok: true,
      value: "night-of-the-living-dead",
    });
  });

  test("rejects uppercase, spaces and empty slugs", () => {
    for (const raw of ["Night", "night_of_the_dead", "night of the dead", ""]) {
      expect(parseFilmSlug(raw).ok).toBe(false);
    }
  });
});
