import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { AboutPage } from "./about-page";
import { SearchPage } from "./search-page";
import { SiteFooter } from "./site-footer";

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <SiteFooter />
    </>
  ),
});
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
