export const DUPLICATE_THRESHOLD = 0.95;

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
  threshold: number,
): DedupResult {
  const kept: number[] = [];
  const dropped: number[] = [];
  let previous: Float32Array | null = null;
  for (let at = 0; at < vectors.length; at += 1) {
    const vector = vectors[at];
    if (vector === undefined) continue;
    if (previous !== null && cosine(previous, vector) > threshold) {
      dropped.push(at);
      continue;
    }
    kept.push(at);
    previous = vector;
  }
  return { kept, dropped };
}
