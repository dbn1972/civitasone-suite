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
const SCAN_DIRS = [join(ROOT, "apps/web/src"), join(ROOT, "packages/ui-kit/src")];
const BASELINE = join(ROOT, "scripts/ci/rtl-baseline.json");

const args = process.argv.slice(2);
const WRITE = args.includes("--write-baseline");
const REPORT = args.includes("--report");

/**
 * Physical, direction-dependent patterns. Each does NOT flip under dir="rtl".
 * Word-boundary anchored so `mb-4` (margin-bottom, direction-neutral) and
 * `border-lime-500` are not matched.
 */
/**
 * NOTE ON `\b` AND ARBITRARY VALUES: a trailing `\b` after `]` can never match,
 * because `]` and the following character are both non-word — so the original
 * patterns were BLIND to every Tailwind arbitrary value (`mr-[2px]`, `left-[10px]`).
 * All patterns below use `(?![\w-])` as the terminator instead, which also stops
 * `-ml-4` inside a longer token from counting.
 */
const END = "(?![\\w-])";
const VAL = "(?:\\d+(?:\\.\\d+)?|px|auto|full|screen|min|max|fit|\\[[^\\]]+\\])";

const PHYSICAL_PATTERNS = [
  // Spacing: ml-/mr-/pl-/pr- (incl. negative -ml-4 and arbitrary ml-[3px])
  new RegExp(`(?<![\\w-])-?[mp][lr]-${VAL}${END}`, "g"),
  // Scroll margin/padding
  new RegExp(`(?<![\\w-])scroll-[mp][lr]-${VAL}${END}`, "g"),
  // Text alignment
  new RegExp(`(?<![\\w-])text-(?:left|right)${END}`, "g"),
  // Float / clear
  new RegExp(`(?<![\\w-])(?:float|clear)-(?:left|right)${END}`, "g"),
  // Directional borders — border-l, border-r-2, border-l-[3px].
  // `border-lime-500` is excluded because `lime` does not match the value set.
  new RegExp(`(?<![\\w-])border-[lr](?:-${VAL})?${END}`, "g"),
  // Directional rounding
  new RegExp(`(?<![\\w-])rounded-(?:[lr]|[tb][lr])(?:-\\w+)?${END}`, "g"),
  // Inset (left-0, right-[10px], inset-x-4 — inset-x does not mirror)
  new RegExp(`(?<![\\w-])-?(?:left|right)-${VAL}${END}`, "g"),
  new RegExp(`(?<![\\w-])-?inset-x-${VAL}${END}`, "g"),
  // Axis utilities that assume LTR order
  new RegExp(`(?<![\\w-])-?space-x-(?:${VAL}|reverse)${END}`, "g"),
  new RegExp(`(?<![\\w-])divide-x(?:-${VAL}|-reverse)?${END}`, "g"),
  // Transform / origin that bake in a direction
  new RegExp(`(?<![\\w-])-?translate-x-${VAL}${END}`, "g"),
  new RegExp(`(?<![\\w-])origin-(?:left|right|top-left|top-right|bottom-left|bottom-right)${END}`, "g"),
  // Inline-style / JS camelCase physical properties
  /\b(?:marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight|borderLeftWidth|borderRightWidth|borderLeftColor|borderRightColor|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)\b/g,
  // Inline-style textAlign: "left" | "right"
  /\btextAlign\s*:\s*["'](?:left|right)["']/g,
  // Raw CSS physical declarations
  /(?:^|[;{\s])(?:margin-left|margin-right|padding-left|padding-right|border-left|border-right|border-left-width|border-right-width|border-left-color|border-right-color|border-top-left-radius|border-top-right-radius|border-bottom-left-radius|border-bottom-right-radius)\s*:/g,
  // Raw CSS positional left/right (but not `left` as a value of text-align,
  // which is caught separately)
  /(?:^|[;{\s])(?:left|right)\s*:\s*(?!auto\s*;?\s*\/\* rtl-ok)/g,
  // Direction-baked values
  /\btext-align\s*:\s*(?:left|right)\b/g,
  /\bbackground-position\s*:\s*(?:left|right)\b/g,
];

/** Logical equivalents — counted only to report progress, never to gate. */
const LOGICAL_PATTERNS = [
  new RegExp(`(?<![\\w-])-?[mp][se]-${VAL}${END}`, "g"),
  new RegExp(`(?<![\\w-])text-(?:start|end)${END}`, "g"),
  new RegExp(`(?<![\\w-])border-[se](?:-${VAL})?${END}`, "g"),
  new RegExp(`(?<![\\w-])-?(?:start|end)-${VAL}${END}`, "g"),
  new RegExp(`(?<![\\w-])-?inset-inline-${VAL}${END}`, "g"),
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

let base;
try {
  base = JSON.parse(readFileSync(BASELINE, "utf8"));
} catch (err) {
  console.error(`[RTL Check] ❌ FAILED: baseline is not valid JSON — ${err.message}`);
  process.exit(1);
}

// Without this, a baseline missing/renaming `physical` makes both comparisons
// below evaluate against `undefined` (always false) and control falls through to
// the success message — the exact unreachable-failure-condition bug class as the
// `logicalRatio < 0` gate this file replaced. Proven: a baseline of
// `{"physicalCount":606}` printed "PASSED" and exited 0.
if (!Number.isInteger(base?.physical) || base.physical < 0) {
  console.error(
    `[RTL Check] ❌ FAILED: baseline at ${relative(ROOT, BASELINE)} is malformed — ` +
      `\`physical\` must be a non-negative integer, got ${JSON.stringify(base?.physical)}. ` +
      `Regenerate with: node scripts/ci/rtl-check.mjs --write-baseline`,
  );
  process.exit(1);
}

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
