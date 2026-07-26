#!/usr/bin/env node
/**
 * RTL-safety gate — real implementation.
 *
 * REPLACES A FAKE GATE. The previous version computed a logical-property ratio
 * and then tested `if (logicalRatio < 0)`, which is mathematically impossible
 * for a ratio of two non-negative counts. It always exited 0 and never failed on
 * any input. It reported "✅ PASSED: RTL-safe layout verified" regardless of the
 * codebase.
 *
 * What this version actually does: counts physical direction-dependent Tailwind
 * utilities and CSS properties in the web app, and RATCHETS against a recorded
 * baseline so the count can only go down. Physical properties (ml-, text-left,
 * border-l-) do not mirror under `dir="rtl"`, which breaks Urdu/Arabic layouts
 * and any future RTL locale.
 *
 * It is a ratchet rather than a hard zero because the existing codebase has a
 * large physical-property population; failing outright would force either a
 * mass refactor or a disabled gate. Neither is acceptable, so instead: you may
 * not add more.
 *
 * Usage:
 *   node scripts/ci/rtl-check.mjs                 # gate (fails if count grows)
 *   node scripts/ci/rtl-check.mjs --write-baseline
 *   node scripts/ci/rtl-check.mjs --report        # list worst offenders
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [join(ROOT, "apps/web/src")];
const BASELINE = join(ROOT, "scripts/ci/rtl-baseline.json");

const args = process.argv.slice(2);
const WRITE = args.includes("--write-baseline");
const REPORT = args.includes("--report");

/**
 * Physical, direction-dependent patterns. Each does NOT flip under dir="rtl".
 * Word-boundary anchored so `mb-4` (margin-bottom, direction-neutral) and
 * `border-lime-500` are not matched.
 */
const PHYSICAL_PATTERNS = [
  // Tailwind spacing: ml-/mr-/pl-/pr- followed by a scale token
  /\b[mp][lr]-(?:\d+|px|auto|\[[^\]]+\])\b/g,
  // Tailwind text alignment
  /\btext-(?:left|right)\b/g,
  // Tailwind float
  /\bfloat-(?:left|right)\b/g,
  // Tailwind directional borders (border-l-2, border-r, but not border-lime-500)
  /\bborder-[lr](?:-(?:\d+|\[[^\]]+\]))?\b(?!\w)/g,
  // Tailwind directional rounding
  /\brounded-(?:[lr]|[tb][lr])(?:-\w+)?\b/g,
  // Tailwind inset
  /\b(?:left|right)-(?:\d+|px|auto|full|\[[^\]]+\])\b/g,
  // Raw CSS / inline-style physical properties
  /\b(?:marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight|textAlign\s*:\s*["']?(?:left|right))\b/g,
  /(?:^|[;{\s])(?:margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:/g,
];

/** Logical equivalents — counted only to report progress, never to gate. */
const LOGICAL_PATTERNS = [
  /\b[mp][se]-(?:\d+|px|auto|\[[^\]]+\])\b/g,
  /\btext-(?:start|end)\b/g,
  /\bborder-[se](?:-(?:\d+|\[[^\]]+\]))?\b(?!\w)/g,
  /\b(?:start|end)-(?:\d+|px|auto|full|\[[^\]]+\])\b/g,
  /\b(?:marginInlineStart|marginInlineEnd|paddingInlineStart|paddingInlineEnd)\b/g,
  /(?:^|[;{\s])(?:margin-inline-start|margin-inline-end|padding-inline-start|padding-inline-end|inset-inline-start|inset-inline-end)\s*:/g,
];

function countMatches(text, patterns) {
  let n = 0;
  for (const re of patterns) {
    const m = text.match(re);
    if (m) n += m.length;
  }
  return n;
}

function collectFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, acc);
    else if (/\.(tsx?|css)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const perFile = [];
let physical = 0;
let logical = 0;

for (const dir of SCAN_DIRS) {
  for (const file of collectFiles(dir)) {
    const text = readFileSync(file, "utf8");
    const p = countMatches(text, PHYSICAL_PATTERNS);
    const l = countMatches(text, LOGICAL_PATTERNS);
    physical += p;
    logical += l;
    if (p > 0) perFile.push({ file: relative(ROOT, file), physical: p, logical: l });
  }
}

const total = physical + logical;
const logicalPct = total > 0 ? Math.round((logical / total) * 100) : 100;

console.log(`[RTL Check] scanned ${SCAN_DIRS.map((d) => relative(ROOT, d)).join(", ")}`);
console.log(`[RTL Check] physical (RTL-unsafe): ${physical}  logical (RTL-safe): ${logical}  logical share: ${logicalPct}%`);

if (REPORT) {
  perFile.sort((a, b) => b.physical - a.physical);
  console.log("\n[RTL Check] worst offenders:");
  for (const f of perFile.slice(0, 25)) {
    console.log(`  ${String(f.physical).padStart(5)}  ${f.file}`);
  }
  console.log(`\n[RTL Check] ${perFile.length} file(s) contain physical properties`);
}

if (WRITE) {
  writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        $comment:
          "RTL-safety ratchet baseline. This is TRACKED DEBT, not an approved state: " +
          "physical direction properties do not mirror under dir=rtl and break RTL locales. " +
          "The gate fails if `physical` grows. Regenerate only after reducing it: " +
          "node scripts/ci/rtl-check.mjs --write-baseline",
        generatedAt: new Date().toISOString().slice(0, 10),
        physical,
        logical,
        logicalPct,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`[RTL Check] baseline written: physical=${physical}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(
    `[RTL Check] ❌ FAILED: no baseline at ${relative(ROOT, BASELINE)}. ` +
      `Create one with: node scripts/ci/rtl-check.mjs --write-baseline`,
  );
  process.exit(1);
}

const base = JSON.parse(readFileSync(BASELINE, "utf8"));

if (physical > base.physical) {
  console.error(
    `\n[RTL Check] ❌ FAILED: RTL-unsafe physical properties grew from ${base.physical} to ${physical} (+${physical - base.physical}).\n` +
      `Physical properties (ml-, mr-, pl-, pr-, text-left/right, border-l/r, left-/right-)\n` +
      `do NOT mirror under dir="rtl" and break RTL locales.\n\n` +
      `Use logical equivalents instead:\n` +
      `  ml-4 -> ms-4        mr-4 -> me-4\n` +
      `  pl-4 -> ps-4        pr-4 -> pe-4\n` +
      `  text-left -> text-start   text-right -> text-end\n` +
      `  border-l -> border-s      border-r -> border-e\n` +
      `  left-0 -> start-0         right-0 -> end-0\n\n` +
      `See the worst offenders with: node scripts/ci/rtl-check.mjs --report\n`,
  );
  process.exit(1);
}

if (physical < base.physical) {
  console.log(
    `[RTL Check] ✅ PASSED — and improved: ${base.physical} -> ${physical} (-${base.physical - physical}). ` +
      `Lock in the gain: node scripts/ci/rtl-check.mjs --write-baseline`,
  );
  process.exit(0);
}

console.log(`[RTL Check] ✅ PASSED — physical count unchanged at ${physical} (ratchet holding)`);
process.exit(0);
