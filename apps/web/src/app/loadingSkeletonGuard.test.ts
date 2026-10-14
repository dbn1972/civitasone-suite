import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * SF-11 guard: every route `loading.tsx` (and every `*Skeleton.tsx` helper) must
 * be built on the shared, token-based skeleton primitives. No baseline, no
 * allow-list: a new loading.tsx that hard-codes `bg-slate-*`/`bg-gray-*` or a
 * hex colour (which ignores dark mode), or that does not use a shared Skeleton
 * component, fails here.
 *
 * "Uses a shared skeleton" = imports a symbol whose name contains `Skeleton`
 * (RouteSkeleton, ds SkeletonBar/SkeletonCard/SkeletonTable/TileHubSkeleton,
 * PageSkeleton, ...).
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

/** Drop comments so prose such as "no bg-slate-50 wrapper" or "#1490" doesn't trip the guard. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export const BAD_COLOUR = /\bbg-(slate|gray|zinc|neutral|stone)-\d|#[0-9a-fA-F]{3,8}\b/;
export const SHARED_SKELETON_IMPORT =
  /import\s+(?:type\s+)?(?:\{[^}]*Skeleton[^}]*\}|\w*Skeleton\w*)\s+from\s+["'][^"']+["']/;

const files = walk(APP_DIR);
const loadingFiles = files.filter((f) => f.endsWith("/loading.tsx"));
const skeletonHelpers = files.filter((f) => /Skeleton\.tsx$/.test(f));

describe("SF-11 loading.tsx guard", () => {
  it("finds the route loading files", () => {
    expect(loadingFiles.length).toBeGreaterThan(400);
  });

  it("detects the patterns it guards against", () => {
    expect(BAD_COLOUR.test('<div className="bg-slate-200" />')).toBe(true);
    expect(BAD_COLOUR.test('<div style={{ background: "#e5e7eb" }} />')).toBe(true);
    expect(BAD_COLOUR.test('<div style={{ background: "var(--line2)" }} />')).toBe(false);
    expect(SHARED_SKELETON_IMPORT.test('import { RouteSkeleton } from "@/app/_components/RouteSkeleton";')).toBe(true);
    expect(SHARED_SKELETON_IMPORT.test('import { PageHeader } from "@/app/_components/ds";')).toBe(false);
  });

  it.each(loadingFiles.map((f) => [relative(APP_DIR, f), f]))("%s is token-based", (_rel, f) => {
    expect(stripComments(readFileSync(f, "utf8"))).not.toMatch(BAD_COLOUR);
  });

  it.each(loadingFiles.map((f) => [relative(APP_DIR, f), f]))("%s uses a shared skeleton", (_rel, f) => {
    expect(stripComments(readFileSync(f, "utf8"))).toMatch(SHARED_SKELETON_IMPORT);
  });

  it.each(skeletonHelpers.map((f) => [relative(APP_DIR, f), f]))("%s helper is token-based", (_rel, f) => {
    expect(stripComments(readFileSync(f, "utf8"))).not.toMatch(BAD_COLOUR);
  });
});
