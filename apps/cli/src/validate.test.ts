import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFilmArg, parseTitle, parseVideoPath } from "./validate.ts";

const scratch = mkdtempSync(join(tmpdir(), "framesearch-validate-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("parseVideoPath", () => {
  test("rejects an empty path", () => {
    expect(parseVideoPath("  ").ok).toBe(false);
  });

  test("rejects a path that is not on disk", () => {
    expect(parseVideoPath(join(scratch, "missing.mp4")).ok).toBe(false);
  });

  test("rejects a directory", () => {
    expect(parseVideoPath(scratch).ok).toBe(false);
  });

  test("rejects a file that is not a video", () => {
    const file = join(scratch, "notes.txt");
    writeFileSync(file, "not a film");
    expect(parseVideoPath(file).ok).toBe(false);
  });

  test("resolves a video to an absolute path", () => {
    const file = join(scratch, "film.mp4");
    writeFileSync(file, "");
    expect(parseVideoPath(file)).toEqual({ ok: true, value: file });
  });
});

describe("parseTitle", () => {
  test("turns a title into its slug", () => {
    expect(parseTitle("  Night of the Living Dead ")).toEqual({
      ok: true,
      value: {
        title: "Night of the Living Dead",
        slug: "night-of-the-living-dead",
      },
    });
  });

  test("strips accents before slugging", () => {
    const parsed = parseTitle("Amélie");
    expect(parsed.ok && parsed.value.slug).toBe("amelie");
  });

  test("rejects a title with no slug characters", () => {
    expect(parseTitle("!!!").ok).toBe(false);
  });

  test("rejects an empty title", () => {
    expect(parseTitle("   ").ok).toBe(false);
  });
});

describe("parseFilmArg", () => {
  test("accepts a lowercase slug", () => {
    expect(parseFilmArg("night-of-the-living-dead")).toEqual({
      ok: true,
      value: "night-of-the-living-dead",
    });
  });

  test("rejects path-like and uppercase names", () => {
    for (const raw of ["../frames", "frames/x", "Night", "night_of", ""]) {
      expect(parseFilmArg(raw).ok).toBe(false);
    }
  });
});
