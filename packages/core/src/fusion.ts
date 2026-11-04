import type { RankedShot } from "@framesearch/schema";

export const RRF_K = 60;

export type Signal = "frame" | "caption" | "bm25";

export interface SignalHits {
  signal: Signal;
  hits: readonly RankedShot[];
}

export type FusionWeights = Partial<Record<Signal, number>>;

export interface FusionOptions {
  weights?: FusionWeights | undefined;
  limit?: number | undefined;
}

export function fuse(
  lists: readonly SignalHits[],
  options: FusionOptions = {},
): RankedShot[] {
  const scores = new Map<number, number>();
  for (const list of lists) {
    const weight = options.weights?.[list.signal] ?? 1;
    if (weight === 0) continue;
    const seen = new Set<number>();
    for (const hit of list.hits) {
      if (seen.has(hit.shotId)) continue;
      seen.add(hit.shotId);
      scores.set(
        hit.shotId,
        (scores.get(hit.shotId) ?? 0) + weight / (RRF_K + seen.size),
      );
    }
  }
  const fused: RankedShot[] = [];
  for (const [shotId, score] of scores) fused.push({ shotId, score });
  fused.sort(
    (left, right) => right.score - left.score || left.shotId - right.shotId,
  );
  return options.limit === undefined ? fused : fused.slice(0, options.limit);
}
