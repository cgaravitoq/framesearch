import type { RankedShot } from "@framesearch/schema";

export const RRF_K = 60;

export type Signal = "frame" | "caption" | "bm25";

const SIGNAL_PRIORITY: readonly Signal[] = ["frame", "caption", "bm25"];

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
  shotOf: (shotId: number) => string,
  options: FusionOptions = {},
): RankedShot[] {
  const shots = new Map<
    string,
    { shotId: number; score: number; priority: number }
  >();
  for (const list of lists) {
    const weight = options.weights?.[list.signal] ?? 1;
    if (weight === 0) continue;
    const priority = SIGNAL_PRIORITY.indexOf(list.signal);
    const seen = new Set<string>();
    for (const hit of list.hits) {
      const shot = shotOf(hit.shotId);
      if (seen.has(shot)) continue;
      seen.add(shot);
      const score = weight / (RRF_K + seen.size);
      const current = shots.get(shot);
      if (current === undefined) {
        shots.set(shot, { shotId: hit.shotId, score, priority });
        continue;
      }
      current.score += score;
      if (priority < current.priority) {
        current.shotId = hit.shotId;
        current.priority = priority;
      }
    }
  }
  const fused: RankedShot[] = [];
  for (const { shotId, score } of shots.values()) fused.push({ shotId, score });
  fused.sort(
    (left, right) => right.score - left.score || left.shotId - right.shotId,
  );
  return options.limit === undefined ? fused : fused.slice(0, options.limit);
}
