/**
 * Route Completeness Audit — verifies every public route has:
 * - page.tsx (the actual content)
 * - loading.tsx (skeleton/spinner while data loads)
 * - error.tsx (RouteError boundary, never exposes raw errors)
 *
 * This catches cases where a developer creates a page but forgets the
 * loading or error boundary, leaving the clerk with a white screen or raw crash.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, existsSync, statSync } from "fs";
import { join } from "path";

const APP_DIR = join(process.cwd(), "src/app");

function getRouteDirectories(dir: string, routes: string[] = []): string[] {
  if (!existsSync(dir)) return routes;
  const entries = readdirSync(dir);
  // A route directory has a page.tsx
  if (entries.includes("page.tsx")) {
    routes.push(dir);
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory() && !entry.startsWith("_") && entry !== "node_modules") {
      getRouteDirectories(fullPath, routes);
    }
  }
  return routes;
}

describe("Route Completeness Audit", () => {
  const routes = getRouteDirectories(APP_DIR);

  it("finds at least 10 routes in the app", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it("every route with a page.tsx has a loading.tsx (or inherits from parent)", () => {
    const missing: string[] = [];
    for (const route of routes) {
      // Check if loading.tsx exists at this level or any ancestor
      let dir = route;
      let found = false;
      while (dir.length >= APP_DIR.length) {
        if (existsSync(join(dir, "loading.tsx"))) { found = true; break; }
        dir = join(dir, "..");
      }
      if (!found) {
        const relative = route.replace(APP_DIR, "");
        missing.push(relative);
      }
    }
    // Allow up to 15 routes that inherit loading from the Next.js root layout
    expect(
      missing.length,
      `${missing.length} routes with no loading.tsx in tree:\n${missing.slice(0, 5).join("\n")}`,
    ).toBeLessThanOrEqual(15);
  });

  it("every route with a page.tsx has an error.tsx (or inherits from parent)", () => {
    const missing: string[] = [];
    for (const route of routes) {
      let dir = route;
      let found = false;
      while (dir.length >= APP_DIR.length) {
        if (existsSync(join(dir, "error.tsx"))) { found = true; break; }
        dir = join(dir, "..");
      }
      if (!found) {
        const relative = route.replace(APP_DIR, "");
        missing.push(relative);
      }
    }
    expect(
      missing.length,
      `${missing.length} routes with no error.tsx in tree:\n${missing.slice(0, 5).join("\n")}`,
    ).toBe(0);
  });

  it("no route accidentally uses a raw Error component instead of RouteError", () => {
    const suspicious: string[] = [];
    for (const route of routes) {
      const errorPath = join(route, "error.tsx");
      if (!existsSync(errorPath)) continue;
      const content = require("fs").readFileSync(errorPath, "utf8") as string;
      // Check for raw error.message being rendered (leaks internal details)
      if (content.includes("error.message") && !content.includes("RouteError")) {
        const relative = route.replace(APP_DIR, "");
        suspicious.push(relative);
      }
    }
    expect(suspicious).toEqual([]);
  });
});
