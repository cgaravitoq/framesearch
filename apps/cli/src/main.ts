import { join } from "node:path";
import { bucketName, databaseName } from "./cloud.ts";
import { DUPLICATE_THRESHOLD } from "./dedup.ts";
import {
  belowThresholds,
  type EvalReport,
  evaluate,
  parseCases,
  type Thresholds,
} from "./eval.ts";
import { indexFilm } from "./indexer.ts";
import { publishFilm } from "./publish.ts";
import { unpublishFilm } from "./unpublish.ts";
import {
  parseBaseUrl,
  parseTitle,
  parseVideoPath,
  unwrap,
} from "./validate.ts";

const DEFAULT_EVAL_FILE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "evals",
  "queries.json",
);

const USAGE = `usage:
  framesearch index <video> --title "<title>"
  framesearch publish <film>
  framesearch unpublish <film>
  framesearch eval --base-url <url> [file] [thresholds]

thresholds:
  --min-hit-at1 <count>    fail below this many queries answered first
  --min-hit-at5 <count>    fail below this many queries answered in the top five
  --min-mrr <ratio>        fail below this MRR@10

env:
  FRAMESEARCH_DATA         local store (default ~/.local/share/framesearch-public)
  EMBED_URL                OpenAI-compatible embeddings server
                           (default http://localhost:8104)
  OPENROUTER_API_KEY       caption key, required by index
  FRAMESEARCH_R2_BUCKET    R2 bucket (default framesearch)
  FRAMESEARCH_D1_DATABASE  D1 database (default framesearch)

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
        `  vectors     ${report.vectorsKeys.join(", ")}`,
        `  wall time   ${report.seconds.toFixed(1)}s`,
      ].join("\n"),
    );
    return;
  }

  if (command === "eval") {
    const { baseUrl, file, thresholds } = parseEvalArgs(args);
    const cases = parseCases(JSON.parse(await Bun.file(file).text()));
    const report = await evaluate(baseUrl, cases);
    console.log(renderEval(report, file, baseUrl));
    const failures = belowThresholds(report, thresholds);
    if (failures.length > 0) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`unknown command ${command}\n\n${USAGE}`);
}

function parseEvalArgs(args: readonly string[]): {
  baseUrl: string;
  file: string;
  thresholds: Thresholds;
} {
  let baseUrl: string | undefined;
  let file: string | undefined;
  const thresholds: Thresholds = {};
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at] ?? "";
    const split = arg.indexOf("=");
    const name = split === -1 ? arg : arg.slice(0, split);
    const inline = split === -1 ? undefined : arg.slice(split + 1);
    if (name.startsWith("--")) {
      const raw = inline ?? args[at + 1];
      if (raw === undefined) throw new Error(`${name} needs a value`);
      if (inline === undefined) at += 1;
      if (name === "--base-url") {
        baseUrl = raw;
        continue;
      }
      if (name === "--min-hit-at1") {
        thresholds.hitAt1 = threshold(name, raw);
        continue;
      }
      if (name === "--min-hit-at5") {
        thresholds.hitAt5 = threshold(name, raw);
        continue;
      }
      if (name === "--min-mrr") {
        thresholds.mrrAt10 = threshold(name, raw);
        continue;
      }
      throw new Error(`unknown option ${name}`);
    }
    if (file !== undefined) throw new Error(`unexpected argument ${arg}`);
    file = arg;
  }
  if (baseUrl === undefined) throw new Error("missing --base-url");
  return {
    baseUrl: unwrap(parseBaseUrl(baseUrl)),
    file: file ?? DEFAULT_EVAL_FILE,
    thresholds,
  };
}

function threshold(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} needs a non-negative number, not ${raw}`);
  }
  return value;
}

function renderEval(report: EvalReport, file: string, baseUrl: string): string {
  const lines = [
    `${report.total} queries from ${file} against ${baseUrl}`,
    `  hit@1   ${`${report.hitAt1}/${report.total}`.padStart(7)}  ${share(report.hitAt1, report.total)}`,
    `  hit@5   ${`${report.hitAt5}/${report.total}`.padStart(7)}  ${share(report.hitAt5, report.total)}`,
    `  MRR@10  ${report.mrrAt10.toFixed(3).padStart(7)}`,
    `  search  p50 ${report.latency.p50.toFixed(0)} ms  p95 ${report.latency.p95.toFixed(0)} ms`,
  ];
  if (report.misses.length > 0) {
    lines.push("misses");
    for (const miss of report.misses) lines.push(`  ${miss}`);
  }
  return lines.join("\n");
}

function share(count: number, total: number): string {
  return total === 0 ? "0.000" : (count / total).toFixed(3);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
