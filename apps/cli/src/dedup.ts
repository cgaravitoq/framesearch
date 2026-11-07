export const DUPLICATE_THRESHOLD = 0.95;
export const MAX_DEDUP_GAP_SECONDS = 20;

export function cosine(left: Float32Array, right: Float32Array): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let at = 0; at < left.length; at += 1) {
    const a = left[at] ?? 0;
    const b = right[at] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

interface DedupResult {
  kept: number[];
  dropped: number[];
}

export function dedupConsecutive(
  vectors: readonly Float32Array[],
  times: readonly number[],
  threshold: number,
): DedupResult {
  const kept: number[] = [];
  const dropped: number[] = [];
  let previous: Float32Array | null = null;
  let previousTime = Number.NEGATIVE_INFINITY;
  for (let at = 0; at < vectors.length; at += 1) {
    const vector = vectors[at];
    const time = times[at] ?? 0;
    if (vector === undefined) continue;
    const near = time - previousTime < MAX_DEDUP_GAP_SECONDS;
    if (previous !== null && near && cosine(previous, vector) > threshold) {
      dropped.push(at);
      continue;
    }
    kept.push(at);
    previous = vector;
    previousTime = time;
  }
  return { kept, dropped };
}
