export type { SignalHits } from "./fusion.ts";
export { fuse, RRF_K } from "./fusion.ts";
export { embedText } from "./query.ts";
export {
  DEFAULT_K,
  MAX_K,
  MAX_QUERY_LENGTH,
  parseFilmSlug,
  parseK,
  parseQuery,
  parseShotId,
  type Validated,
} from "./validation.ts";
export { createVectorStore, type FilmVectorSet } from "./vector-store.ts";
