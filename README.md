# framesearch

Find the shot you remember by describing it: type "a helicopter over a field" and get back the frames, each with its film and timecode.
It ships with one film, Night of the Living Dead, and anyone can search it read-only.

## How it works

- `apps/cli` (Bun, local): ffmpeg cuts a video into shots, embeddings come from a local llama.cpp, captions from OpenRouter, and one command publishes frames, rows and int8 vectors to R2 and D1.
  A publish stamps its vectors as `vectors/<slug>-<uuid>.bin` and names that object in the D1 published row, so the next publish writes a new file instead of overwriting the one live searches read.
- `apps/api` (Hono on Workers): reads through one D1 session served by a nearby replica, embeds the query, ranks the int8 frame and caption vectors held in memory, asks D1 FTS5 for keyword hits, fuses both with RRF and returns each shot once.
  Every search and similar reply carries a `server-timing` header with the D1, embed and total milliseconds.
- `apps/embedder`: llama.cpp serving EmbeddingGemma 2 in a Cloudflare container reached through a Durable Object, with a primary instance plus two overflow instances that `sleepAfter` an hour, so the deployed Worker carries no embeddings key.
- `apps/web`: the React SPA the same Worker serves, search as you type, English UI with English and Spanish example queries.
- `packages/schema` and `packages/core`: the contracts and the pure ranking code both sides share.

## Self-hosting

You need a Cloudflare account with Workers, D1, R2 and Containers, plus Bun 1.4 or newer and a logged-in `wrangler`.

1. Create the resources: `wrangler r2 bucket create framesearch` and `wrangler d1 create framesearch`, then put the returned id in `apps/api/wrangler.jsonc`.
2. Keep the container, or serve embeddings yourself: set `EMBED_URL` (a local llama.cpp at `http://localhost:8104` works), `EMBED_API_KEY` and `EMBED_MODEL` as secrets and the Worker stops calling the container.
3. `bun install`, then `bun run typecheck`, `bun run lint` and `bun run test`.
4. Create the tables, ship the API and warm the embedder: `bun run --cwd apps/api migrate`, `bun run --cwd apps/web build`, `bun run --cwd apps/api deploy`, then `curl https://<your-worker>/api/prewarm` so the first search does not wait for the model to load.
5. Index a film on your machine: `bun run framesearch index night.mp4 --title "Night of the Living Dead"`. It needs `OPENROUTER_API_KEY` for the captions.
6. Publish it: `bun run framesearch publish night-of-the-living-dead` writes the frames and vectors to R2 and the rows to D1.

Merging to main also deploys: `.github/workflows/deploy.yml` wants `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, applies migrations, deploys, warms the embedder with the same prewarm call, then runs `framesearch eval` against the live URL and rolls the Worker back when hit@5 or MRR@10 fall below the thresholds.
Publish a film before that first merge, or the eval has nothing to find.

Features ship behind booleans in the `vars` of `apps/api/wrangler.jsonc`, read through `readFlags` and exposed at `/api/flags`; a flag that is missing or not a boolean is off.
`SEARCH_LOG` keeps the anonymous search log on.

MIT licensed.
