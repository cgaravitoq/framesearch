import type {
  D1Database,
  R2Bucket,
  RateLimit,
} from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  FRAMES: R2Bucket;
  SEARCH_RATE_LIMIT: RateLimit;
  EMBED_URL?: string | undefined;
  EMBED_API_KEY?: string | undefined;
  EMBED_MODEL?: string | undefined;
}
