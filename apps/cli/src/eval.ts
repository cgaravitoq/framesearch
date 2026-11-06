interface Expected {
  film: string;
  from: number;
  to: number;
}

interface EvalCase {
  query: string;
  film: string;
  expected: Expected[];
}

interface Metrics {
  hitAt1: number;
  hitAt5: number;
  mrrAt10: number;
}

interface Latency {
  p50: number;
  p95: number;
}

export interface EvalReport extends Metrics {
  total: number;
  latency: Latency;
  misses: string[];
}

export interface Thresholds {
  hitAt1?: number | undefined;
  hitAt5?: number | undefined;
  mrrAt10?: number | undefined;
}

const EVAL_K = 10;
const HIT_LIMIT = 5;

interface SiteHit {
  film: string;
  shotStart: number;
  shotEnd: number;
}

export function parseCases(raw: unknown): EvalCase[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      "the eval file must be a JSON array of { query, expected }",
    );
  }
  return raw.map((entry: unknown, index) => {
    const where = `query ${index}`;
    if (!isRecord(entry)) throw new Error(`${where} must be an object`);
    if (typeof entry.query !== "string" || entry.query.trim() === "") {
      throw new Error(`${where}.query must be a non-empty string`);
    }
    if (!Array.isArray(entry.expected) || entry.expected.length === 0) {
      throw new Error(`${where}.expected must be a non-empty array`);
    }
    const expected = entry.expected.map((range: unknown, at) =>
      parseExpected(range, `${where}.expected[${at}]`),
    );
    const films = [...new Set(expected.map((range) => range.film))];
    const [film] = films;
    if (film === undefined || films.length > 1) {
      throw new Error(
        `${where} expects ranges in several films (${films.join(", ")}); keep each query to one film`,
      );
    }
    return { query: entry.query, film, expected };
  });
}

export interface EvalRun {
  gated: EvalReport;
  crossFilm: EvalReport;
  failures: string[];
}

export async function runEval(
  baseUrl: string,
  cases: readonly EvalCase[],
  thresholds: Thresholds,
): Promise<EvalRun> {
  const gated = await evaluate(baseUrl, cases, "per-film");
  const crossFilm = await evaluate(baseUrl, cases, "all-films");
  return { gated, crossFilm, failures: belowThresholds(gated, thresholds) };
}

export async function evaluate(
  baseUrl: string,
  cases: readonly EvalCase[],
  scope: "per-film" | "all-films",
): Promise<EvalReport> {
  const samples: number[] = [];
  const ranks: (number | undefined)[] = [];
  for (const testCase of cases) {
    const started = performance.now();
    const hits = await search(
      baseUrl,
      testCase.query,
      scope === "per-film" ? testCase.film : undefined,
    );
    samples.push(performance.now() - started);
    ranks.push(relevanceRank(hits, testCase.expected));
  }
  const metrics = score(ranks);
  return {
    ...metrics,
    total: cases.length,
    latency: { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) },
    misses: cases
      .filter((_, at) => {
        const rank = ranks[at];
        return rank === undefined || rank > HIT_LIMIT;
      })
      .map((testCase) => testCase.query),
  };
}

export function score(ranks: readonly (number | undefined)[]): Metrics {
  let hitAt1 = 0;
  let hitAt5 = 0;
  let reciprocal = 0;
  for (const rank of ranks) {
    if (rank === undefined) continue;
    if (rank <= 1) hitAt1 += 1;
    if (rank <= HIT_LIMIT) hitAt5 += 1;
    reciprocal += 1 / rank;
  }
  return {
    hitAt1,
    hitAt5,
    mrrAt10: ranks.length === 0 ? 0 : reciprocal / ranks.length,
  };
}

export function belowThresholds(
  report: EvalReport,
  thresholds: Thresholds,
): string[] {
  const failures: string[] = [];
  if (thresholds.hitAt1 !== undefined && report.hitAt1 < thresholds.hitAt1) {
    failures.push(`hit@1 ${report.hitAt1} is below ${thresholds.hitAt1}`);
  }
  if (thresholds.hitAt5 !== undefined && report.hitAt5 < thresholds.hitAt5) {
    failures.push(`hit@5 ${report.hitAt5} is below ${thresholds.hitAt5}`);
  }
  if (thresholds.mrrAt10 !== undefined && report.mrrAt10 < thresholds.mrrAt10) {
    failures.push(
      `MRR@10 ${report.mrrAt10.toFixed(3)} is below ${thresholds.mrrAt10}`,
    );
  }
  return failures;
}

function relevanceRank(
  hits: readonly SiteHit[],
  expected: readonly Expected[],
): number | undefined {
  for (let at = 0; at < Math.min(hits.length, EVAL_K); at += 1) {
    const hit = hits[at];
    if (hit !== undefined && matches(hit, expected)) return at + 1;
  }
  return undefined;
}

function matches(hit: SiteHit, expected: readonly Expected[]): boolean {
  return expected.some(
    (range) =>
      hit.film === range.film &&
      hit.shotStart <= range.to &&
      hit.shotEnd >= range.from,
  );
}

async function search(
  baseUrl: string,
  query: string,
  film: string | undefined,
): Promise<SiteHit[]> {
  const url = new URL(`${baseUrl}/api/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("k", String(EVAL_K));
  if (film !== undefined) url.searchParams.set("film", film);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `${url} answered ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.results)) {
    throw new Error(`${url} answered without a results array`);
  }
  return body.results.map((hit: unknown, at) =>
    toHit(hit, `${url} result ${at}`),
  );
}

function parseExpected(raw: unknown, where: string): Expected {
  if (!isRecord(raw)) {
    throw new Error(`${where} must be an object with film, from and to`);
  }
  const { film, from, to } = raw;
  if (typeof film !== "string" || film === "") {
    throw new Error(`${where}.film must be a non-empty slug`);
  }
  if (typeof from !== "number" || typeof to !== "number") {
    throw new Error(`${where} needs numeric from and to`);
  }
  if (from > to) throw new Error(`${where} has from ${from} after to ${to}`);
  return { film, from, to };
}

function toHit(raw: unknown, where: string): SiteHit {
  if (!isRecord(raw)) throw new Error(`${where} is not an object`);
  const { film, shotStart, shotEnd } = raw;
  if (
    typeof film !== "string" ||
    typeof shotStart !== "number" ||
    typeof shotEnd !== "number"
  ) {
    throw new Error(`${where} holds no film, shotStart and shotEnd`);
  }
  return { film, shotStart, shotEnd };
}

function percentile(samples: readonly number[], share: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const at = Math.ceil(share * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, at))] ?? 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
