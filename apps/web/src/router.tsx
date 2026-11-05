import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AboutPage } from "./about-page";
import { SearchPage } from "./search-page";

const rootRoute = createRootRoute();
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: SearchPage,
});
const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: AboutPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, aboutRoute]),
});
