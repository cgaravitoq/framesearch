import { describe, expect, test } from "bun:test";
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

async function render(path: string): Promise<string> {
  const page = createRouter({
    routeTree: router.routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await page.load();
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
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
