import { expect, test } from "bun:test";
import { fuse, RRF_K } from "./fusion.ts";

test("fuses each shot once as its best frame", () => {
  const shotOf = (shotId: number) => (shotId === 3 ? "b" : "a");
  const fused = fuse(
    [
      {
        signal: "frame",
        hits: [
          { shotId: 2, score: 0.9 },
          { shotId: 1, score: 0.8 },
          { shotId: 3, score: 0.7 },
        ],
      },
      {
        signal: "caption",
        hits: [
          { shotId: 1, score: 0.6 },
          { shotId: 3, score: 0.5 },
        ],
      },
    ],
    shotOf,
  );
  expect(fused).toEqual([
    { shotId: 2, score: 2 / (RRF_K + 1) },
    { shotId: 3, score: 2 / (RRF_K + 2) },
  ]);
});
