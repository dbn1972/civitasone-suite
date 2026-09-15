#!/usr/bin/env node
// contradictory-badge-guard.mjs — UX-012: find page.tsx + sibling Table/Client
// component pairs where the page renders a legacy `<DataSourceBadge
// source={...} />` (fed by the raw server `source`) while a sibling
// table/list component in the SAME directory independently calls
// `useSeededResource` (which has its own cache/provenance state). This is
// exactly UX-002's contradictory-badge shape, per
// docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's UX-012 row and PR #1126: the
// page's badge and the table's rows can disagree about whether the data on
// screen is live, cached, or missing, because they independently derive that
// state from two different reads of the same failed fetch.
//
// Fix shape (established by PR #1126, applied mechanically per pair):
//   - remove the page-level `<DataSourceBadge source={source} .../>` import+JSX
//   - the sibling table/client destructures `provenance`/`offline`/`cachedAt`
//     from its OWN `useSeededResource` call (already has the call; just reads
//     one more field) and renders `<DataSourceBadge provenance={...} .../>`
//     itself, preserving that site's original error message text via the
//     `message` override prop.
//
// This is a standalone enumeration/verification tool for the UX-012 sweep,
// not (yet) wired into the arch-guard CI job — see the UX-012 PR description
// for why (a hard CI gate needs a keyed-entry ratchet baseline like
// UX-024 gave raw-status-leak-guard.mjs; out of scope for this tranche).
//
// Usage: node scripts/ci/contradictory-badge-guard.mjs [--write-baseline] [--quiet]
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../../apps/web/src/app");
const BASELINE_PATH = path.resolve(new URL(".", import.meta.url).pathname, "contradictory-badge-baseline.json");

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
}

const allFiles = [];
walk(ROOT, allFiles);

const pageFiles = allFiles.filter((f) => f.endsWith("page.tsx"));

function importsDataSourceBadge(src) {
  return /from\s+["'][^"']*_components\/DataSourceBadge["']/.test(src);
}
function usesLegacySourceBadge(src) {
  // <DataSourceBadge ... source={ ...   (allow multiline attrs before source=)
  return /<DataSourceBadge\b[\s\S]{0,400}?\bsource=/.test(src);
}
function importsUseSeededResource(src) {
  return /useSeededResource/.test(src) && /from\s+["'][^"']*lib\/sync\/resource["']/.test(src);
}

const pairs = [];
const moduleCounts = {};

// NOTE: earlier drafts of this guard restricted siblings to filenames ending
// in Table.tsx/Client.tsx (mirroring the gap report's own wording). That
// missed real pairs using other naming (UserManagementPage.tsx,
// QueryResultsView.tsx, UsageDisplay.tsx) — verified by hand before fixing
// this. The actual necessary-and-sufficient condition is just "some sibling
// file in the same directory independently calls useSeededResource", so we
// check every sibling file regardless of name.
for (const pageFile of pageFiles) {
  const src = readFileSync(pageFile, "utf8");
  if (!importsDataSourceBadge(src)) continue;
  if (!usesLegacySourceBadge(src)) continue; // already fixed (provenance) or badge unused

  const dir = path.dirname(pageFile);
  const siblingFiles = allFiles.filter(
    (f) => path.dirname(f) === dir && f !== pageFile && !f.endsWith(".test.tsx") && !f.endsWith(".test.ts"),
  );
  const matchingTables = siblingFiles.filter((f) => {
    const tsrc = readFileSync(f, "utf8");
    return importsUseSeededResource(tsrc);
  });

  if (matchingTables.length === 0) continue;

  const relDir = path.relative(ROOT, dir);
  const relPage = path.relative(ROOT, pageFile);
  const relTables = matchingTables.map((f) => path.relative(ROOT, f));

  // module = first path segment, skipping the (app) route group
  const segs = relDir.split(path.sep).filter((s) => !s.startsWith("("));
  const module = segs[0] || "(root)";

  pairs.push({ dir: relDir, page: relPage, tables: relTables, module });
  moduleCounts[module] = (moduleCounts[module] || 0) + 1;
}

// Special-cased shared pair called out explicitly in the gap report.
const sharedPageCandidate = allFiles.find((f) => f.endsWith("_components/ModuleListPage.tsx"));
const sharedTableCandidate = allFiles.find((f) => f.endsWith("_components/ModuleListTable.tsx"));
let sharedPairFlag = null;
if (sharedPageCandidate) {
  const src = readFileSync(sharedPageCandidate, "utf8");
  if (importsDataSourceBadge(src) && usesLegacySourceBadge(src)) {
    sharedPairFlag = {
      page: path.relative(ROOT, sharedPageCandidate),
      table: sharedTableCandidate ? path.relative(ROOT, sharedTableCandidate) : null,
      tableImportsHook: sharedTableCandidate ? importsUseSeededResource(readFileSync(sharedTableCandidate, "utf8")) : false,
    };
  }
}

const result = {
  generatedAt: new Date().toISOString(),
  totalPairs: pairs.length,
  moduleCounts,
  pairs: pairs.sort((a, b) => a.dir.localeCompare(b.dir)),
  sharedModuleListPageTablePair: sharedPairFlag,
};

if (process.argv.includes("--write-baseline")) {
  writeFileSync(BASELINE_PATH, JSON.stringify(result, null, 2) + "\n");
  console.error(`Wrote baseline: ${BASELINE_PATH}`);
}

console.log(JSON.stringify({ totalPairs: result.totalPairs, moduleCounts: result.moduleCounts, sharedModuleListPageTablePair: result.sharedModuleListPageTablePair }, null, 2));
if (!process.argv.includes("--quiet")) {
  for (const p of result.pairs) {
    console.log(`${p.module.padEnd(16)} ${p.dir}  (page: ${p.page.split("/").pop()}, table: ${p.tables.map(t=>t.split("/").pop()).join(",")})`);
  }
}
