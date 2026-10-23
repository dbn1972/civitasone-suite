import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guard: `#page-heading` is the single, unique h1 of a route (aria-labelledby
 * target, E2E anchor, WCAG 4.1.1 unique-id). Route skeletons (`loading.tsx`,
 * `*Skeleton.tsx`) stream in alongside / before the real page, so they must
 * never render an `id="page-heading"` (or any h1): use
 * `<div data-skeleton-heading>` instead.
 */
const APP_DIR = __dirname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else out.push(full);
  }
  return out;
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const sources = walk(APP_DIR).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
const rel = (f: string) => relative(APP_DIR, f);

describe("#page-heading uniqueness guard", () => {
  it("route skeletons never render id=page-heading or an h1", () => {
    const offenders = sources
      .filter((f) => f.endsWith("/loading.tsx") || /Skeleton\w*\.tsx$/.test(f))
      .filter((f) => /id=["']page-heading["']|<h1[\s>]/.test(strip(readFileSync(f, "utf8"))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("each page file declares id=page-heading literally at most once", () => {
    const offenders = sources
      .filter((f) => (strip(readFileSync(f, "utf8")).match(/id=["']page-heading["']/g) ?? []).length > 1)
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
