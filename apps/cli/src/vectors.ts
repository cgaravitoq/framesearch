import {
  type FilmVectors,
  quantizeVector,
  type ShotVector,
} from "@framesearch/schema";

export interface VectorSource {
  shotId: number;
  frame: Float32Array;
  caption: Float32Array | null;
}

export interface VectorRow {
  id: number;
  caption: string | null;
}

export function buildVectors(sources: readonly VectorSource[]): FilmVectors {
  const dim = sources[0]?.frame.length ?? 0;
  if (dim === 0) throw new Error("no frames to encode");
  const frames: ShotVector[] = [];
  const captions: ShotVector[] = [];
  for (const source of sources) {
    if (source.frame.length !== dim) {
      throw new Error(
        `shot ${source.shotId} holds a ${source.frame.length}-d frame, expected ${dim}`,
      );
    }
    frames.push({
      shotId: source.shotId,
      values: quantizeVector(source.frame),
    });
    if (source.caption !== null) {
      captions.push({
        shotId: source.shotId,
        values: quantizeVector(source.caption),
      });
    }
  }
  return { dim, frames, captions };
}

export function assertVectorsMatch(
  shots: readonly VectorRow[],
  vectors: FilmVectors,
): void {
  const problems: string[] = [];
  const frameIds = shotIds(vectors.frames, "frame", problems);
  const captionIds = shotIds(vectors.captions, "caption", problems);
  const expectedFrames = new Set(shots.map((shot) => shot.id));
  const expectedCaptions = new Set(
    shots.filter((shot) => shot.caption !== null).map((shot) => shot.id),
  );
  compare(expectedFrames, frameIds, "frame", problems);
  compare(expectedCaptions, captionIds, "caption", problems);
  if (problems.length > 0) {
    throw new Error(
      `vectors file does not match the film rows: ${problems.join("; ")}`,
    );
  }
}

function shotIds(
  records: readonly ShotVector[],
  kind: string,
  problems: string[],
): Set<number> {
  const ids = new Set<number>();
  for (const record of records) {
    if (ids.has(record.shotId)) {
      problems.push(`${kind} shot ${record.shotId} appears twice`);
    }
    ids.add(record.shotId);
  }
  return ids;
}

function compare(
  expected: ReadonlySet<number>,
  actual: ReadonlySet<number>,
  kind: string,
  problems: string[],
): void {
  const missing = [...expected].filter((id) => !actual.has(id));
  const unexpected = [...actual].filter((id) => !expected.has(id));
  if (missing.length > 0) {
    problems.push(
      `${missing.length} ${kind} rows have no vector (${list(missing)})`,
    );
  }
  if (unexpected.length > 0) {
    problems.push(
      `${unexpected.length} ${kind} vectors point at no row (${list(unexpected)})`,
    );
  }
}

function list(ids: readonly number[]): string {
  const head = ids.slice(0, 5).join(", ");
  return ids.length > 5 ? `${head}, ...` : head;
}
