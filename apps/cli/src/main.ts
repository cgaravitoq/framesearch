import { bucketName, databaseName } from "./cloud.ts";
import { DUPLICATE_THRESHOLD } from "./dedup.ts";
import { indexFilm } from "./indexer.ts";
import { publishFilm } from "./publish.ts";
import { unpublishFilm } from "./unpublish.ts";
import { parseTitle, parseVideoPath, unwrap } from "./validate.ts";

const USAGE = `usage:
  framesearch index <video> --title "<title>"
  framesearch publish <film>
  framesearch unpublish <film>

env:
  FRAMESEARCH_DATA         local store (default ~/.local/share/framesearch-public)
  EMBED_URL                OpenAI-compatible embeddings server
                           (default http://localhost:8104)
  OPENROUTER_API_KEY       caption key, required by index
  FRAMESEARCH_R2_BUCKET    R2 bucket (default framesearch-staging)
  FRAMESEARCH_D1_DATABASE  D1 database (default framesearch-staging)

publish and unpublish need \`npx -y wrangler@4\` with a logged-in Cloudflare account.`;

function parseIndexArgs(args: readonly string[]): {
  video: string;
  title: string;
} {
  let video: string | undefined;
  let title: string | undefined;
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at];
    if (arg === undefined) continue;
    if (arg === "--title") {
      const value = args[at + 1];
      if (value === undefined) throw new Error("--title needs a value");
      title = value;
      at += 1;
      continue;
    }
    if (arg.startsWith("--title=")) {
      title = arg.slice("--title=".length);
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
    if (video !== undefined) throw new Error(`unexpected argument ${arg}`);
    video = arg;
  }
  if (video === undefined) throw new Error("missing <video>");
  if (title === undefined) throw new Error("missing --title");
  return { video, title };
}

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2);
  if (command === undefined || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }

  if (command === "index") {
    const { video, title } = parseIndexArgs(args);
    const path = unwrap(parseVideoPath(video));
    const parsed = unwrap(parseTitle(title));
    const report = await indexFilm({
      video: path,
      title: parsed.title,
      slug: parsed.slug,
    });
    console.log(
      [
        `${report.film.title} (${report.film.slug})`,
        `  duration    ${report.film.duration.toFixed(1)}s in ${report.detectedShots} shots from ${report.cuts} cuts`,
        `  kept        ${report.kept} frames (${report.dropped} near-duplicates dropped above cosine ${DUPLICATE_THRESHOLD})`,
        `  captions    ${report.captioned}/${report.kept} (${report.failedCaptions} unanswered, $${report.costUsd.toFixed(4)})`,
        `  wall time   ${report.seconds.toFixed(1)}s`,
      ].join("\n"),
    );
    return;
  }

  if (command === "publish") {
    const slug = args[0];
    if (slug === undefined) throw new Error("missing <film>");
    const report = await publishFilm(slug);
    console.log(
      [
        `${report.film} -> ${bucketName()}/${databaseName()}`,
        `  rows        ${report.shots} shots (${report.captions} captioned)`,
        `  frames      ${report.frames} objects under frames/${report.film}/`,
        `  vectors     ${report.vectorsKey} (${report.vectorBytes} bytes)`,
        `  wall time   ${report.seconds.toFixed(1)}s`,
      ].join("\n"),
    );
    return;
  }

  if (command === "unpublish") {
    const slug = args[0];
    if (slug === undefined) throw new Error("missing <film>");
    const report = await unpublishFilm(slug);
    console.log(
      [
        `${report.film} removed from ${bucketName()}/${databaseName()}`,
        `  frames      ${report.frames} objects under frames/${report.film}/`,
        `  vectors     ${report.vectorsKey}`,
        `  wall time   ${report.seconds.toFixed(1)}s`,
      ].join("\n"),
    );
    return;
  }

  throw new Error(`unknown command ${command}\n\n${USAGE}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
