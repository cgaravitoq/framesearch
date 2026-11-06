import { afterEach, expect, test } from "bun:test";
import { parseCases, runEval } from "./eval.ts";

const realFetch = globalThis.fetch;
const requested: URL[] = [];

afterEach(() => {
  globalThis.fetch = realFetch;
  requested.length = 0;
});

function serve(hitsFor: (url: URL) => { film: string; shot: number }[]): void {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      requested.push(url);
      const results = hitsFor(url).map(({ film, shot }) => ({
        film,
        shotStart: shot,
        shotEnd: shot + 1,
      }));
      return Response.json({ results });
    },
    { preconnect: realFetch.preconnect },
  );
}

const cases = parseCases([
  { query: "a cemetery", expected: [{ film: "night", from: 10, to: 12 }] },
  { query: "a helicopter", expected: [{ film: "wwz", from: 50, to: 51 }] },
]);

const otherFilmOutranksUnfiltered = (url: URL) => {
  const film = url.searchParams.get("film");
  const right =
    url.searchParams.get("q") === "a cemetery"
      ? { film: "night", shot: 10 }
      : { film: "wwz", shot: 50 };
  if (film !== null) return [right];
  return [1, 2, 3, 4, 5, 6]
    .map((shot) => ({ film: "other", shot }))
    .concat(right);
};

test("the gated score searches each query within its own film", async () => {
  serve(otherFilmOutranksUnfiltered);
  await runEval("https://site.test", cases, {});
  const films = requested.map((url) => [
    url.searchParams.get("q"),
    url.searchParams.get("film"),
  ]);
  expect(films).toEqual([
    ["a cemetery", "night"],
    ["a helicopter", "wwz"],
    ["a cemetery", null],
    ["a helicopter", null],
  ]);
});

test("thresholds gate only the per-film score", async () => {
  serve(otherFilmOutranksUnfiltered);
  const run = await runEval("https://site.test", cases, {
    hitAt1: 2,
    hitAt5: 2,
    mrrAt10: 1,
  });
  expect(run.gated.hitAt1).toBe(2);
  expect(run.crossFilm).toMatchObject({ hitAt5: 0 });
  expect(run.failures).toEqual([]);
});

test("the cross-film score cannot fail the run even at zero", async () => {
  serve((url) =>
    url.searchParams.get("film") === null
      ? []
      : [
          { film: "night", shot: 10 },
          { film: "wwz", shot: 50 },
        ],
  );
  const run = await runEval("https://site.test", cases, { hitAt5: 2 });
  expect(run.crossFilm).toMatchObject({ hitAt5: 0 });
  expect(run.failures).toEqual([]);
});

test("a cross-film pass that errors cannot fail the run", async () => {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.searchParams.get("film") === null) {
        return new Response("upstream down", { status: 502 });
      }
      return Response.json({
        results: [
          { film: url.searchParams.get("film"), shotStart: 10, shotEnd: 50 },
        ],
      });
    },
    { preconnect: realFetch.preconnect },
  );
  const run = await runEval("https://site.test", cases, { hitAt5: 2 });
  expect(run.gated.hitAt5).toBe(2);
  expect(run.crossFilm).toMatchObject({
    error: expect.stringContaining("502"),
  });
  expect(run.failures).toEqual([]);
});

test("a query whose ranges span several films is rejected", () => {
  expect(() =>
    parseCases([
      {
        query: "a crowd",
        expected: [
          { film: "night", from: 1, to: 2 },
          { film: "wwz", from: 3, to: 4 },
        ],
      },
    ]),
  ).toThrow("query 0 expects ranges in several films (night, wwz)");
});
