import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { SearchPage } from "./search-page";

const rootRoute = createRootRoute();
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: SearchPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute]),
});
