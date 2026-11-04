export interface Film {
  slug: string;
  title: string;
  duration: number;
}

export interface Shot {
  film: string;
  idx: number;
  time: number;
  shotStart: number;
  shotEnd: number;
  caption: string | null;
  tags: string[];
}

export interface Hit {
  shotId: number;
  film: string;
  title: string;
  time: number;
  shotStart: number;
  shotEnd: number;
  frameUrl: string;
  caption: string | null;
  tags: string[];
  score: number;
}

export interface SearchReply {
  query: string;
  film: string | null;
  results: Hit[];
}

export type VectorKind = "frame" | "caption";

export interface RankOptions {
  kind: VectorKind;
  film?: string | undefined;
  exclude?: number | undefined;
}

export interface RankedShot {
  shotId: number;
  score: number;
}

export interface VectorStore {
  rank(query: Float32Array, options: RankOptions): RankedShot[];
}
