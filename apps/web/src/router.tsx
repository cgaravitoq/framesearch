import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AboutPage } from "./about-page";
import { LandingPage } from "./landing-page";
import { NotFoundPage } from "./not-found-page";
import { SearchPage } from "./search-page";

interface SearchParams {
  q?: string;
  shot?: number;
}

function readSearch(raw: Record<string, unknown>): SearchParams {
  const q = typeof raw.q === "string" ? raw.q : String(raw.q ?? "");
  const shot = Number(raw.shot);
  return {
    ...(q === "" ? {} : { q }),
    ...(Number.isInteger(shot) && shot > 0 ? { shot } : {}),
  };
}

const rootRoute = createRootRoute({ notFoundComponent: NotFoundPage });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LandingPage,
});
const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  validateSearch: readSearch,
  component: SearchRoute,
});
const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: AboutPage,
});

function SearchRoute() {
  const { q, shot } = searchRoute.useSearch();
  return <SearchPage start={{ q: q ?? "", shot: shot ?? null }} />;
}

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, searchRoute, aboutRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
