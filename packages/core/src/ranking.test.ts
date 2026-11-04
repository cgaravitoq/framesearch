import { describe, expect, test } from "bun:test";
import {
  type FilmVectors,
  quantizeVector,
  type ShotVector,
} from "@framesearch/schema";
import { createVectorStore } from "./vector-store.ts";

const DIM = 768;
const COUNT = 32;
const FILM = "night-of-the-living-dead";

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function unit(next: () => number): Float32Array {
  const values = new Float32Array(DIM);
  let norm = 0;
  for (let at = 0; at < DIM; at += 1) {
    const value = next() * 2 - 1;
    values[at] = value;
    norm += value * value;
  }
  const scale = 1 / Math.sqrt(norm);
  for (let at = 0; at < DIM; at += 1) {
    values[at] = (values[at] ?? 0) * scale;
  }
  return values;
}

function orthogonal(next: () => number, direction: Float32Array): Float32Array {
  const noise = unit(next);
  const projection = dot(noise, direction);
  let norm = 0;
  for (let at = 0; at < DIM; at += 1) {
    noise[at] = (noise[at] ?? 0) - projection * (direction[at] ?? 0);
    norm += (noise[at] ?? 0) ** 2;
  }
  const scale = 1 / Math.sqrt(norm);
  for (let at = 0; at < DIM; at += 1) {
    noise[at] = (noise[at] ?? 0) * scale;
  }
  return noise;
}

function dot(left: Float32Array, right: Float32Array): number {
  let sum = 0;
  for (let at = 0; at < left.length; at += 1) {
    sum += (left[at] ?? 0) * (right[at] ?? 0);
  }
  return sum;
}

describe("int8 vector store", () => {
  test("ranks in the same order as float32 vectors", () => {
    const query = unit(random(11));
    const floats: Float32Array[] = [];
    const frames: ShotVector[] = [];
    for (let index = 0; index < COUNT; index += 1) {
      const cosine = 0.95 - (index * 0.75) / (COUNT - 1);
      const noise = orthogonal(random(1000 + index), query);
      const spread = Math.sqrt(1 - cosine * cosine);
      const values = new Float32Array(DIM);
      let norm = 0;
      for (let at = 0; at < DIM; at += 1) {
        const value = (query[at] ?? 0) * cosine + (noise[at] ?? 0) * spread;
        values[at] = value;
        norm += value * value;
      }
      const scale = 1 / Math.sqrt(norm);
      for (let at = 0; at < DIM; at += 1) {
        values[at] = (values[at] ?? 0) * scale;
      }
      floats.push(values);
      frames.push({ shotId: index + 1, values: quantizeVector(values) });
    }

    const expected = floats
      .map((values, at) => ({ shotId: at + 1, score: dot(values, query) }))
      .sort(
        (left, right) => right.score - left.score || left.shotId - right.shotId,
      )
      .map((hit) => hit.shotId);

    const vectors: FilmVectors = { dim: DIM, frames, captions: [] };
    const store = createVectorStore([{ film: FILM, vectors }]);
    const actual = store
      .rank(query, { kind: "frame" })
      .map((hit) => hit.shotId);

    expect(actual).toEqual(expected);
  });

  test("ranks an empty caption column without throwing", () => {
    const frames: ShotVector[] = [
      { shotId: 1, values: new Int8Array(DIM).fill(1) },
    ];
    const vectors: FilmVectors = { dim: DIM, frames, captions: [] };
    const store = createVectorStore([{ film: FILM, vectors }]);
    expect(store.rank(unit(random(5)), { kind: "caption" })).toEqual([]);
  });
});
