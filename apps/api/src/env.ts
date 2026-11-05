import type {
  D1Database,
  DurableObjectNamespace,
  R2Bucket,
  RateLimit,
} from "@cloudflare/workers-types";
import type { EmbedderContainer } from "./embedder.ts";

export type Env = {
  DB: D1Database;
  FRAMES: R2Bucket;
  SEARCH_RATE_LIMIT: RateLimit;
  SEARCH_LOG?: boolean | undefined;
  EMBEDDER?: DurableObjectNamespace<EmbedderContainer> | undefined;
  EMBED_URL?: string | undefined;
  EMBED_API_KEY?: string | undefined;
  EMBED_MODEL?: string | undefined;
};
