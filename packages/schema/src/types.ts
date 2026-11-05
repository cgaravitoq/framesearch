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

export interface FilmsReply {
  films: Film[];
}

export type FlagsReply = Readonly<Record<string, boolean>>;

export interface SimilarReply {
  shotId: number;
  results: Hit[];
}

export interface ClickLogRequest {
  searchId: number;
  shotId: number;
  rank: number | null;
}

export interface SearchLogReply {
  logged: boolean;
  id: number | null;
}

export interface ClickLogReply extends SearchLogReply {
  rank: number | null;
}

export interface ErrorReply {
  error: string;
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
  vector(kind: VectorKind, shotId: number): Int8Array | undefined;
}
