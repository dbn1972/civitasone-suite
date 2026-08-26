#!/usr/bin/env node
// Regenerates src/app/_components/navRouteManifest.ts — the allowlist of ancestor
// route paths that AutoBreadcrumb may safely turn into links (they have a real
// index page.tsx). Run from apps/web:  node scripts/gen-nav-route-manifest.mjs
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const APP_DIR = join(here, "..", "src", "app", "(app)");
const OUT = join(here, "..", "src", "app", "_components", "navRouteManifest.ts");

/** @param {string} dir */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name === "page.tsx" || name === "page.ts") out.push(dir);
  }
  return out;
}

function toRoutePath(dir) {
  const rel = relative(APP_DIR, dir);
  const parts = rel
    .split(/[\\/]/)
    .filter((p) => p && !(p.startsWith("(") && p.endsWith(")")));
  return "/" + parts.join("/");
}

const routes = new Set(walk(APP_DIR).map(toRoutePath));
const inter = new Set();
for (const r of routes) {
  const segs = r.split("/").filter(Boolean);
  if (segs.some((s) => s.startsWith("["))) continue; // dynamic — skipped by breadcrumb
  let cum = "";
  for (let i = 0; i < segs.length; i++) {
    cum += "/" + segs[i];
    if (i === segs.length - 1) break; // current page, never an intermediate link
    if (routes.has(cum)) inter.add(cum);
  }
}

const sorted = [...inter].sort();
const header = `// AUTO-GENERATED — do not hand-edit path entries.
//
// The set of ancestor route paths that (a) appear as an intermediate breadcrumb
// crumb somewhere in the app AND (b) actually have their own index \`page.tsx\`,
// so navigating to them resolves instead of 404-ing.
//
// WHY THIS EXISTS: <AutoBreadcrumb> builds a crumb for every ancestor segment of
// the current path. Several ancestor segments are pure groupings with children
// but NO index page (e.g. /finance/budget, /finance/treasury, /estab/files,
// /legal/cases). Linking those crumbs sent the clerk to a dead 404 route. The
// breadcrumb now links an intermediate crumb ONLY when its path is in this set,
// and otherwise renders the label as plain (non-clickable) context text.
//
// SAFE DEGRADATION: this allowlist can go mildly stale without ever causing a
// 404 or a wrong link — a missing entry only downgrades a real link to plain
// text. Regenerate with:  node scripts/gen-nav-route-manifest.mjs
// (from apps/web). Kept intentionally free of a filesystem-freshness test so it
// never couples this shared component's CI to unrelated route additions.

export const LINKABLE_INTERMEDIATE_PATHS: ReadonlySet<string> = new Set([
`;
const body = sorted.map((p) => `  "${p}",`).join("\n");
const footer = `
]);

/** True when an intermediate breadcrumb crumb at \`path\` resolves to a real page. */
export function isLinkableCrumb(path: string): boolean {
  return LINKABLE_INTERMEDIATE_PATHS.has(path);
}
`;
writeFileSync(OUT, header + body + footer);
console.log(`Wrote ${sorted.length} paths to ${OUT}`);
