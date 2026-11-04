import type {
  FilmVectors,
  RankedShot,
  RankOptions,
  VectorKind,
  VectorStore,
} from "@framesearch/schema";

export interface FilmVectorSet {
  film: string;
  vectors: FilmVectors;
}

interface Column {
  dim: number;
  shotIds: Int32Array;
  filmSlots: Int32Array;
  values: Int8Array;
  slots: Map<string, number>;
}

export function createVectorStore(
  films: readonly FilmVectorSet[],
): VectorStore {
  const columns: Record<VectorKind, Column> = {
    frame: toColumn(films, "frames"),
    caption: toColumn(films, "captions"),
  };
  return {
    rank(query, options) {
      return rank(columns[options.kind], query, options);
    },
  };
}

function toColumn(
  films: readonly FilmVectorSet[],
  key: "frames" | "captions",
): Column {
  const slots = new Map<string, number>();
  const entries: { shotId: number; slot: number; values: Int8Array }[] = [];
  let dim = 0;
  for (const film of films) {
    const records = film.vectors[key];
    if (records.length === 0) continue;
    if (dim === 0) {
      dim = film.vectors.dim;
    } else if (dim !== film.vectors.dim) {
      throw new Error(
        `film ${film.film} holds ${film.vectors.dim}-d vectors, expected ${dim}`,
      );
    }
    let slot = slots.get(film.film);
    if (slot === undefined) {
      slot = slots.size;
      slots.set(film.film, slot);
    }
    for (const record of records) {
      entries.push({ shotId: record.shotId, slot, values: record.values });
    }
  }
  const shotIds = new Int32Array(entries.length);
  const filmSlots = new Int32Array(entries.length);
  const values = new Int8Array(entries.length * dim);
  entries.forEach((entry, at) => {
    shotIds[at] = entry.shotId;
    filmSlots[at] = entry.slot;
    values.set(entry.values, at * dim);
  });
  return { dim, shotIds, filmSlots, values, slots };
}

function rank(
  column: Column,
  query: Float32Array,
  options: RankOptions,
): RankedShot[] {
  const { dim, shotIds, filmSlots, values } = column;
  if (query.length !== dim) {
    throw new Error(`query holds ${query.length} values, expected ${dim}`);
  }
  let filmSlot: number | undefined;
  if (options.film !== undefined) {
    filmSlot = column.slots.get(options.film);
    if (filmSlot === undefined) return [];
  }
  const ranked: RankedShot[] = [];
  for (let at = 0; at < shotIds.length; at += 1) {
    const shotId = shotIds[at] ?? 0;
    if (shotId === options.exclude) continue;
    if (filmSlot !== undefined && filmSlots[at] !== filmSlot) continue;
    const start = at * dim;
    let score = 0;
    for (let index = 0; index < dim; index += 1) {
      score += (query[index] ?? 0) * (values[start + index] ?? 0);
    }
    ranked.push({ shotId, score });
  }
  ranked.sort(
    (left, right) => right.score - left.score || left.shotId - right.shotId,
  );
  return ranked;
}
