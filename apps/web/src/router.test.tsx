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
const SHARED_COLUMN =
  /<div class="[^"]*max-w-\[\d+px\][^"]*"><main\b[\s\S]*<\/main><footer\b[^>]*>[\s\S]*<\/footer><\/div>/;

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
    test(`${path} shows the copyright footer in the page's own column`, async () => {
      const html = await render(path);
      expect(html).toContain(COPYRIGHT_LINE);
      expect(html).toMatch(SHARED_COLUMN);
    });
  }
});
