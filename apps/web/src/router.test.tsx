import { describe, expect, test } from "bun:test";
import type { Hit } from "@framesearch/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { router } from "./router";

const COPYRIGHT_LINE = "Frames are copyrighted and belong to their owners";
const FOOTER_AFTER_MAIN =
  /<\/main><footer\b[^>]*>[\s\S]*Frames are copyrighted and belong to their owners[\s\S]*<\/footer>/;
const SHARED_COLUMN =
  /<div class="[^"]*max-w-\[\d+px\][^"]*"><main\b[\s\S]*<\/main><footer\b[^>]*>[\s\S]*<\/footer><\/div>/;
const FULL_BLEED = new Set(["/"]);

async function render(
  path: string,
  client = new QueryClient(),
): Promise<string> {
  const page = createRouter({
    routeTree: router.routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await page.load();
  return renderToString(
    <QueryClientProvider client={client}>
      <RouterProvider router={page} />
    </QueryClientProvider>,
  );
}

describe("every page", () => {
  for (const path of Object.keys(router.routesByPath)) {
    test(`${path} shows the copyright footer right after the page's content`, async () => {
      const html = await render(path);
      expect(html).toContain(COPYRIGHT_LINE);
      expect(html).toMatch(FOOTER_AFTER_MAIN);
      if (!FULL_BLEED.has(path)) expect(html).toMatch(SHARED_COLUMN);
    });
  }
});

describe("an unknown path", () => {
  test("shows the copyright footer in the page's own column", async () => {
    const html = await render("/no-such-page");
    expect(html).toContain("This page is not in any film.");
    expect(html).toMatch(SHARED_COLUMN);
  });
});

test("the router knows the landing, search and about pages", () => {
  expect(Object.keys(router.routesByPath).sort()).toEqual([
    "/",
    "/about",
    "/search",
  ]);
});

describe("the search page", () => {
  test("waits for three characters before it searches", async () => {
    const html = await render("/search?q=ab");
    expect(html).toContain("or start from one of these.");
    expect(html).not.toContain("Searching for");
  });
});

const FARMHOUSE = "a farmhouse at night";

function shot(shotId: number): Hit {
  return {
    shotId,
    film: "night",
    title: "Night of the Living Dead",
    time: shotId * 60,
    shotStart: shotId * 60,
    shotEnd: shotId * 60 + 4,
    frameUrl: `/frames/night/${shotId}.webp`,
    caption: `shot ${shotId}`,
    tags: [],
    score: 1,
  };
}

function answered(term: string, k: number, results: Hit[]): QueryClient {
  const client = new QueryClient();
  client.setQueryData(["search", term, k], {
    reply: { query: term, film: null, results },
    serverMs: 9,
  });
  return client;
}

describe("a search opened from a link", () => {
  test("waits out the debounce before it searches the linked query", async () => {
    const html = await render(
      `/search?q=${encodeURIComponent(FARMHOUSE)}`,
      answered(FARMHOUSE, 12, [shot(1)]),
    );
    expect(html).toContain("Searching for");
    expect(html).not.toContain(shot(1).frameUrl);
  });
});
