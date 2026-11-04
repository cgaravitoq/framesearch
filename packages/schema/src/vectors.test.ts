import { describe, expect, test } from "bun:test";
import { decodeVectors, encodeVectors, type FilmVectors } from "./index.ts";

const SAMPLE: FilmVectors = {
  dim: 4,
  frames: [
    { shotId: 7, values: Int8Array.from([127, -128, 0, 1]) },
    { shotId: 9, values: Int8Array.from([-1, -2, -3, -4]) },
  ],
  captions: [{ shotId: 7, values: Int8Array.from([5, 6, 7, 8]) }],
};

describe("vectors", () => {
  test("roundtrips frames and captions with their shot ids", () => {
    expect(decodeVectors(encodeVectors(SAMPLE))).toEqual(SAMPLE);
  });

  test("roundtrips a film without captions", () => {
    const framesOnly: FilmVectors = { ...SAMPLE, captions: [] };
    expect(decodeVectors(encodeVectors(framesOnly))).toEqual(framesOnly);
  });

  test("rejects a truncated header", () => {
    const bytes = encodeVectors(SAMPLE);
    expect(() => decodeVectors(bytes.subarray(0, 14))).toThrow(/truncated/);
  });

  test("rejects a truncated body", () => {
    const bytes = encodeVectors(SAMPLE);
    expect(() =>
      decodeVectors(bytes.subarray(0, bytes.byteLength - 1)),
    ).toThrow(/truncated/);
  });

  test("rejects a wrong version", () => {
    const bytes = encodeVectors(SAMPLE);
    const patched = Uint8Array.from(bytes);
    patched[4] = 2;
    expect(() => decodeVectors(patched)).toThrow(/version 2/);
  });

  test("rejects a buffer that is not a vector file", () => {
    const bytes = Uint8Array.from([0, 0, 0, 0, ...encodeVectors(SAMPLE)]);
    expect(() => decodeVectors(bytes.subarray(0, 15))).toThrow(
      /not a framesearch vector file/,
    );
  });
});
