import type { Hit } from "@framesearch/schema";
import {
  createRootRoute,
  createRoute,
  createRouter,
  useLocation,
} from "@tanstack/react-router";
import { AboutPage } from "./about-page";
import { LandingPage } from "./landing-page";
import { NotFoundPage } from "./not-found-page";
import { SearchPage, SIZES } from "./search-page";

interface SearchParams {
  q?: string;
  k?: number;
  shot?: number;
}

function readSearch(raw: Record<string, unknown>): SearchParams {
  const q = typeof raw.q === "string" ? raw.q : String(raw.q ?? "");
  const k = Number(raw.k);
  const shot = Number(raw.shot);
  return {
    ...(q === "" ? {} : { q }),
    ...(SIZES.includes(k) ? { k } : {}),
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
  const { q, k, shot } = searchRoute.useSearch();
  const state = useLocation({ select: (location) => location.state });
  const held = "shot" in state && isHit(state.shot) ? state.shot : null;
  return (
    <SearchPage start={{ q: q ?? "", k: k ?? 12, shot: shot ?? null, held }} />
  );
}

function isHit(value: unknown): value is Hit {
  if (typeof value !== "object" || value === null) return false;
  const shot: Partial<Record<keyof Hit, unknown>> = value;
  return (
    typeof shot.shotId === "number" &&
    typeof shot.film === "string" &&
    typeof shot.title === "string" &&
    typeof shot.time === "number" &&
    typeof shot.frameUrl === "string" &&
    typeof shot.thumbUrl === "string" &&
    typeof shot.displayUrl === "string" &&
    Array.isArray(shot.tags)
  );
}

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, searchRoute, aboutRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
