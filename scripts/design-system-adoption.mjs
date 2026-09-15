#!/usr/bin/env node
/**
 * Design-system adoption — what fraction of app pages actually use the
 * shared component library (apps/web/src/app/_components/ds/*, ModuleHub,
 * PageShell), vs. rolling their own markup.
 *
 * Written for UX-010 (skill 20, "UX / Usability" §1 cited stale "1 file" /
 * "3 files" adoption figures from an earlier, much smaller snapshot of the
 * app). Re-run this whenever those numbers are cited again instead of
 * hand-grepping — that's how they went stale silently the first time.
 *
 * Methodology: parse the import statements of every page.tsx under
 * apps/web/src/app/(app)/**, and treat a page as having adopted the design
 * system if any import's source path contains _components/ds,
 * _components/ModuleHub, or _components/PageShell. Named imports are
 * tallied per-component so individual-component adoption (e.g. PageHeader
 * vs. Term) can be told apart from "uses the library at all".
 *
 * Usage:
 *   node scripts/design-system-adoption.mjs [--json]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP_DIR = join(ROOT, "apps/web/src/app/(app)");
const jsonOut = process.argv.includes("--json");

const IMPORT_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs;
const DS_SRC_RE = /_components\/(ds\b|ModuleHub\b|PageShell\b)/;

function walkPageFiles(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkPageFiles(p, acc);
    else if (ent.name === "page.tsx") acc.push(p);
  }
  return acc;
}

function namesFrom(namesBlob) {
  return namesBlob
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

const pageFiles = walkPageFiles(APP_DIR);
const componentFileCounts = new Map();
let adoptedCount = 0;

for (const file of pageFiles) {
  const text = readFileSync(file, "utf8");
  const found = new Set();
  for (const match of text.matchAll(IMPORT_RE)) {
    const [, namesBlob, src] = match;
    if (DS_SRC_RE.test(src)) {
      for (const name of namesFrom(namesBlob)) found.add(name);
    }
  }
  if (found.size > 0) {
    adoptedCount += 1;
    for (const name of found) {
      componentFileCounts.set(name, (componentFileCounts.get(name) ?? 0) + 1);
    }
  }
}

const total = pageFiles.length;
const pct = total === 0 ? 0 : (100 * adoptedCount) / total;
const breakdown = [...componentFileCounts.entries()].sort((a, b) => b[1] - a[1]);

if (jsonOut) {
  console.log(
    JSON.stringify(
      {
        scope: "apps/web/src/app/(app)/**/page.tsx",
        totalPages: total,
        adoptedPages: adoptedCount,
        adoptionPct: Math.round(pct * 10) / 10,
        perComponentFileCounts: Object.fromEntries(breakdown),
      },
      null,
      2,
    ),
  );
} else {
  console.log(`Total page.tsx under apps/web/src/app/(app): ${total}`);
  console.log(`Pages importing >=1 shared ds/ModuleHub/PageShell component: ${adoptedCount}`);
  console.log(`Adoption: ${pct.toFixed(1)}%`);
  console.log("");
  console.log("Per-component file counts:");
  for (const [name, count] of breakdown) {
    console.log(`  ${name}: ${count}`);
  }
}
