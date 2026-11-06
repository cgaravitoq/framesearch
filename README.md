# framesearch

Find the shot you remember by describing it.
Type "a man boarding up a window" and get back the frames that match, each with its film and timecode.

<p align="center">
  <img src="docs/media/demo.webp" alt="Typing a description on the search page, the matching shots arriving, opening one and then one of the shots that look like it" width="960">
</p>

Try it at [framesearch.carlos-garavito.workers.dev](https://framesearch.carlos-garavito.workers.dev).
The public site holds a handful of films, and anyone can search them read-only.

## What it does

- Searches as you type, in English or Spanish, and works best when you describe what is visible rather than the plot.
- Opens a shot with its caption, its tags and its timecode.
- Lists the shots that look like the one you opened, so one good hit leads to the rest of the scene.

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/media/landing.png">
    <img src="docs/media/hero.webp" alt="The Frame Search landing page with its halftone film projector" width="960">
  </picture>
</p>

## How it works

A film is cut into shots on your machine, and each shot gets an embedding of its frame and of a caption written for it.
A search embeds your words with the same model, ranks every frame and caption by meaning, adds keyword hits, and fuses both lists into one.
The vectors are int8 and sit in the Worker's memory, so ranking needs no vector database.
The embedder is EmbeddingGemma 2 on llama.cpp in a Cloudflare Container, and keyword search is D1 FTS5.

## Architecture

- `apps/cli` (Bun, local): ffmpeg cuts a video into shots, embeddings come from a local llama.cpp, captions from OpenRouter, and one command publishes frames, rows and int8 vectors to R2 and D1.
  A publish stamps its vectors as `vectors/<slug>-<uuid>.bin` and names that object in the D1 published row, so the next publish writes a new file instead of overwriting the one live searches read.
- `apps/api` (Hono on Workers): reads through one D1 session served by a nearby replica, embeds the query, ranks the int8 frame and caption vectors held in memory, asks D1 FTS5 for keyword hits, fuses both with RRF and returns each shot once.
  Every search and similar reply carries a `server-timing` header with the D1, embed and total milliseconds.
- `apps/embedder`: llama.cpp serving EmbeddingGemma 2 in a Cloudflare container reached through a Durable Object, with a primary instance plus two overflow instances, each sleeping after 10 idle minutes (`sleepAfter`) since every page load prewarms it, so the deployed Worker carries no embeddings key.
- `apps/web`: the React SPA the same Worker serves: a landing page at `/` and the search at `/search`, which searches as you type, opens a shot with its similar shots and its place in the film, and takes English and Spanish queries.
  It self-hosts its fonts (Space Grotesk, IBM Plex Sans and Geist Mono, under the OFL) and uses three MIT blocks from bencho, kept with their licence in `src/bencho`.
- `packages/schema` and `packages/core`: the contracts and the pure ranking code both sides share.

## Numbers

Measured on a local run, not on the public site, where the first search after the embedder has slept waits a few seconds for the model to load.

- `/api/search` takes 28 ms end to end.
- Embedding the query takes 11.1 ms at p50, and ranking takes 5.4 ms at p50.
- Ranking 300,000 shots takes 178 ms.
- Searching all 8 films at once, 30 of 36 eval queries put the right shot in the top five, with an MRR of 0.742; within each query's own film it is 34 of 36 and 0.836.

## Self-hosting

You need a Cloudflare account with Workers, D1, R2 and Containers, plus Bun 1.4 or newer and a logged-in `wrangler`.

1. Create the resources: `wrangler r2 bucket create framesearch` and `wrangler d1 create framesearch`, then put the returned id in `apps/api/wrangler.jsonc`.
2. Keep the container, or serve embeddings yourself: set `EMBED_URL` (a local llama.cpp at `http://localhost:8104` works), `EMBED_API_KEY` and `EMBED_MODEL` as secrets and the Worker stops calling the container.
3. `bun install`, then `bun run typecheck`, `bun run lint` and `bun run test`.
4. Create the tables, ship the API and warm the embedder: `bun run --cwd apps/api migrate`, `bun run --cwd apps/web build`, `bun run --cwd apps/api deploy`, then `curl https://<your-worker>/api/prewarm` so the first search does not wait for the model to load.
5. Index a film on your machine: `bun run framesearch index night.mp4 --title "Night of the Living Dead"`. It needs `OPENROUTER_API_KEY` for the captions.
6. Publish it: `bun run framesearch publish night-of-the-living-dead` writes the frames and vectors to R2 and the rows to D1.

Merging to main also deploys: `.github/workflows/deploy.yml` wants `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, applies migrations, deploys, warms the embedder with the same prewarm call, then runs `framesearch eval` against the live URL, which searches each query within its own film, and rolls the Worker back when that per-film hit@5 or MRR@10 fall below the thresholds; the cross-film score prints alongside as information only.
The deploy reads its eval queries from `evals/queries.json` in the R2 bucket, kept out of the repository because they name the films you index.
The file is a JSON array of `{ "query": "...", "expected": [{ "film": "<slug>", "from": <s>, "to": <s> }] }`, uploaded with `wrangler r2 object put framesearch/evals/queries.json --file queries.json --remote`.
The eval scores only the queries whose film is published, and with none of them published it passes with nothing to gate.

Features ship behind booleans in the `vars` of `apps/api/wrangler.jsonc`, read through `readFlags` and exposed at `/api/flags`; a flag that is missing or not a boolean is off.
`SEARCH_LOG` keeps the anonymous search log on.

## Legal

The frames belong to their rights holders and are shown at reduced resolution as a fair-use defence, with no licence granted.
The [about page](https://framesearch.carlos-garavito.workers.dev/about) has the full note, and rights holders ask for removal through GitHub issues.

The code is MIT licensed.
