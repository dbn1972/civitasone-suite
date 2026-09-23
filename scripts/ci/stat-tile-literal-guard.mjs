#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// stat-tile-literal-guard.mjs — CI-guard follow-up to the sa-dashboard fix
// (#1472: "stop fabricating Super Admin dashboard uptime/services metrics").
//
// THE GAP THIS CLOSES
// --------------------
// #1472 fixed two live stat tiles that rendered a hardcoded literal
// (`value="33"` for Services; Platform Uptime defaulted to the literal
// "99.9%") with full visual confidence, styled identically to every other,
// genuinely data-bound tile next to them. Nothing caught this at review
// time because no static check looks at a stat tile's `value` prop
// specifically — the existing FABRICATED_DATA gate
// (scripts/contract/screen-map.mjs's scanForFabricatedArray, wired into
// .github/workflows/ci.yml's "Gate — fail on MISSING, MISMATCH, or
// FABRICATED_DATA screens" step, COMP-004) is a DIFFERENT pattern at a
// DIFFERENT granularity: it flags a page-level UPPER_SNAKE_CASE constant
// holding an array/object of multiple record-shaped entries, and ONLY on a
// page with NO loader at all. A single scalar literal passed straight to
// one JSX attribute, on a page that DOES have a real loader (sa-dashboard
// has getSADashboard()), is invisible to it by construction — extending
// that detector would mean bolting an unrelated JSX-attribute check onto an
// unrelated loader-wiring analysis. This is a new, narrowly-scoped guard
// instead.
//
// WHAT IT FLAGS
// -------------
// A JSX element that's clearly a stat/metric tile — a component named
// Stat|Metric|Kpi + Card|Tile(+Grid) (StatCard, StatCardGrid, MetricTile,
// KpiCard, ...; grounded in this repo's actual
// apps/web/src/app/_components/ds/StatCard.tsx + StatCardGrid.tsx, the only
// two such components live today) — whose `value` prop (StatCard) or whose
// `items`/`stats` array entries' `value` field (StatCardGrid-shaped) is a
// literal that looks like a real metric (leads with a digit, after
// stripping an optional leading currency symbol: "33", "99.9%", "8 hrs",
// "₹42,000") rather than this app's own honest-placeholder vocabulary ("—",
// "-", "--", "N/A", "Unknown", "TBD", ...; see StatCard.tsx's
// displayValue()) or a real expression — whether that literal sits bare in
// the attribute (`value="33"`) or one syntax hop inside a shape that reads
// as data-bound but isn't:
//   - a template literal whose substitution is ITSELF a bare literal, with
//     no genuinely dynamic part anywhere in the template
//     (`` value={`${"99.9"}%`} ``);
//   - a ternary with a fabricated literal on either branch
//     (`value={isDemo ? "99.9%" : liveUptime}`);
//   - a `??`/`||` fallback whose literal side is a fabricated metric rather
//     than this app's honest placeholder
//     (`value={data?.uptime ?? "99.9%"}`, `value={undefined ?? "33"}`).
// An identifier, member/call expression, a template literal with at least
// one genuinely dynamic substitution (`` `${online}/${total}` ``), a
// ternary whose branches are each either a real expression or the honest
// placeholder, or a `??`/`||` fallback whose literal side IS the honest
// placeholder (`uptime ?? "—"`) is still treated as data-bound and left
// alone.
//
// WHAT IT DELIBERATELY DOES NOT CATCH (scope, not oversight)
// ------------------------------------------------------------
// - A literal one hop away through a variable, e.g.
//     const uptime = dashboard.uptime ?? "99.9%";  <StatCard value={uptime} />
//   is invisible to a JSX-attribute-site check by construction — that is a
//   data-flow question, a fundamentally different (and far more expensive)
//   analysis than this guard is. This is precisely half of #1472's own
//   original bug shape: the Services half (`value="33"`, a bare literal
//   directly in the JSX attribute) IS caught by this guard; the Uptime half
//   was already one hop removed through a `const` even before the fix and
//   would not have been caught by this guard either — it was only found by
//   manual review + a live-verify. Tracing values back through arbitrary
//   variable assignments is left for a future, heavier tool if this gap
//   proves costly in practice.
// - The template/ternary/`??`/`||` recursion above composes through CHAINS
//   of those same shapes (a ternary branch that's itself a template, a `??`
//   whose fallback is itself a nested ternary, ...) — it is not artificially
//   capped at one level, so e.g. `` `${config?.max ?? 1000}/min` `` (a
//   template substitution that's a `??` fallback) is caught too. What stops
//   the recursion is hitting a genuinely different node kind: an identifier,
//   a call/member expression, or any binary operator other than `??`/`||`
//   (string concatenation, `&&`, comparisons, ...). A literal buried inside
//   a call argument, or reached through one of those other operators, is
//   not descended into — recursing into arbitrary expression trees risks
//   new false positives (e.g. a `+`-concatenated prefix) this guard can't
//   cleanly bound, so that stays out of scope here.
// - `delta`/trend props, icon colors, and every other non-`value` prop.
// - An `items`/`stats` array assigned to a variable first
//   (`const ROWS = [...]; <StatCardGrid items={ROWS} />`) rather than
//   written inline in the JSX — a module-scope hardcoded record array is
//   screen-map.mjs's job (COMP-004), not this guard's.
// A team that deliberately, permanently hardcodes a stat value (a policy
// constant that is genuinely the same for every tenant, not a stand-in for
// something a backend should serve) can mark it with a `static reference`
// comment directly above the element — the same escape-hatch convention
// screen-map.mjs's scanForFabricatedArray already established for the
// identical purpose, kept as one shared phrase rather than two to remember.
//
// WHY A RATCHET, NOT A HARD CUTOVER
// -----------------------------------
// Same convention as empty-vs-error-guard.mjs / raw-status-leak-guard.mjs /
// jsx-a11y-ratchet-guard.mjs: fails on any NEW (file:line:tag) key not
// already in scripts/ci/stat-tile-literal-baseline.json, and on any STALE
// entry (fixed but left listed) — so a real fix must be accompanied by a
// re-baseline in the same PR. The baseline this guard ships with captures
// whatever this repo's tree already contained at write time as tracked
// debt, not an endorsement — see that file's own _comment.
//
// Usage:
//   node scripts/ci/stat-tile-literal-guard.mjs                 # guard: exit 1 on
//                                                                 # new/stale baseline entries
//   node scripts/ci/stat-tile-literal-guard.mjs --report         # print full violation list,
//                                                                 # does not affect exit code
//   node scripts/ci/stat-tile-literal-guard.mjs --write-baseline # regenerate the baseline from
//                                                                 # the current tree
// ─────────────────────────────────────────────────────────────────────────────
import ts from "typescript";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const WEB_SRC_DIR = join(REPO_ROOT, "apps", "web", "src");
const BASELINE_PATH = join(__dirname, "stat-tile-literal-baseline.json");
const SELF_PATH = fileURLToPath(import.meta.url);

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// ── 1. File walking ──────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", "coverage", ".turbo"]);

function* walkFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walkFiles(full);
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      if (entry.name.endsWith(".test.tsx") || entry.name.endsWith(".spec.tsx")) continue;
      if (entry.name.endsWith(".stories.tsx")) continue;
      if (full === SELF_PATH) continue;
      yield full;
    }
  }
}

function discoverSourceFiles() {
  if (!existsSync(WEB_SRC_DIR)) return [];
  return [...walkFiles(WEB_SRC_DIR)];
}

// ── 2. Detect hardcoded stat-tile literals ───────────────────────────────────

// A component name that reads as a stat/metric tile. Grounded in this
// repo's actual components (StatCard, StatCardGrid) with headroom for a
// reasonably named sibling — deliberately not a generic "any Card" match,
// which would flag unrelated components (NavCard, ApprovalCard, ...) that
// don't carry a headline metric at all.
const STAT_TILE_NAME_RE = /^(Stat|Metric|Kpi)(Card|Tile)(Grid)?$/;

// This app's own honest-placeholder vocabulary (see StatCard.tsx's
// displayValue(), and #1472's own commit message: "matching this app's
// established convention for an unavailable stat"). Never flagged.
const HONEST_PLACEHOLDERS = new Set(["—", "-", "--", "n/a", "na", "unknown", "tbd", "...", "?", ""]);

// Same escape-hatch phrase as screen-map.mjs's scanForFabricatedArray /
// STATIC_REFERENCE_MARKER — one shared convention across both
// fabricated-data guards, not two to remember. Unlike screen-map.mjs's
// version (which just windows 8 lines back from a module-scope
// declaration, reasonable there since declarations are rarely stacked
// densely), JSX elements commonly sit one per line — a fixed line-count
// window would let a marker comment above ONE stat tile silently also
// suppress a genuinely fabricated value on an unrelated tile a couple of
// lines below it. So this scans backward line-by-line and stops at the
// first line that is neither blank nor a comment line — i.e. the marker
// must be immediately above THIS element (blank lines and multi-line
// comment blocks in between are fine; another element's own JSX is not).
const STATIC_REFERENCE_MARKER = /static reference/i;
const COMMENT_LINE_RE = /^\{?\/\*|^\*|\*\/\}?$|^\/\//;
function hasStaticReferenceMarker(sourceLines, elementLine0) {
  const floor = Math.max(0, elementLine0 - 8);
  for (let i = elementLine0 - 1; i >= floor; i--) {
    const trimmed = (sourceLines[i] ?? "").trim();
    if (trimmed === "") continue;
    if (STATIC_REFERENCE_MARKER.test(trimmed)) return true;
    if (!COMMENT_LINE_RE.test(trimmed)) return false; // real code — marker doesn't reach past it
  }
  return false;
}

// Does this literal text look like a real metric (leads with a digit, once
// an optional leading currency symbol is stripped) rather than this app's
// own honest "we don't know" placeholder? "33", "99.9%", "8 hrs",
// "₹42,000" all match; "—", "-", "N/A", "Unknown", "", "Active" (a status
// word, not a number) do not.
function looksLikeFabricatedMetric(text) {
  const trimmed = String(text).trim();
  if (trimmed === "") return false;
  if (HONEST_PLACEHOLDERS.has(trimmed.toLowerCase())) return false;
  const stripped = trimmed.replace(/^[₹$€£]\s*/, "");
  return /^-?[0-9]/.test(stripped);
}

// Extracts the literal text from an expression node — either a bare literal
// itself, or one of the handful of one-hop-removed shapes below that
// resolve to a fabricated literal even though they read as data-bound at a
// glance. Returns null for a real identifier/member/call expression, or for
// a template/ternary/`??`/`||` whose relevant side(s) are all genuinely
// dynamic — those are left alone (see the header's "deliberately does not
// catch").
function literalTextOf(expr) {
  if (!expr) return null;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isNumericLiteral(expr)) return expr.text;
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return `-${expr.operand.text}`;
  }
  // A template literal WITH a substitution (`` `${x}%` ``) is only a bare
  // literal in disguise when EVERY substitution itself resolves to literal
  // text, recursively — e.g. `` `${"99.9"}%` ``. This is an AND across all
  // spans: one genuinely dynamic substitution (`` `${online}/${total}` ``)
  // makes the whole template return null here, same as before this fix.
  if (ts.isTemplateExpression(expr)) {
    let text = expr.head.text;
    for (const span of expr.templateSpans) {
      const spanText = literalTextOf(span.expression);
      if (spanText === null) return null;
      text += spanText + span.literal.text;
    }
    return text;
  }
  // A ternary, or a `??`/`||` fallback, is normally a data-bound shape —
  // but that was only ever meant to hold when the literal side (if any) is
  // this app's own honest "—" placeholder, or when neither side is a
  // fabricated literal at all. It was never meant to blanket-exempt an
  // arbitrary fabricated metric sitting in one branch
  // (`isDemo ? "99.9%" : liveUptime`, `data?.uptime ?? "99.9%"`,
  // `undefined ?? "33"`) — that is exactly the #1472 bug shape, one syntax
  // hop removed. So: check each side; a side that is itself a bare literal
  // AND looks fabricated (per looksLikeFabricatedMetric, which already
  // excludes the honest-placeholder vocabulary) is surfaced. A side that
  // resolves to the honest placeholder, or doesn't resolve to a literal at
  // all (the genuinely data-bound case — an identifier, call, member
  // access), contributes nothing, so the ternary/fallback stays exempt,
  // unchanged from before. This is an OR across sides, unlike the AND used
  // for template spans above: only one side needs to be fabricated for the
  // whole expression to count as one.
  if (ts.isConditionalExpression(expr)) {
    return fabricatedSideOf(expr.whenTrue, expr.whenFalse);
  }
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return fabricatedSideOf(expr.left, expr.right);
  }
  return null;
}

// Shared by the ConditionalExpression and `??`/`||` cases above. Returns
// the first side's literal text if that side is both a bare literal and
// fabricated-looking, else null. (reportIfFabricated re-checks
// looksLikeFabricatedMetric on whatever literalTextOf returns, so doing the
// check here too is a harmless redundant pass-through, not a second
// independent gate.)
function fabricatedSideOf(...sides) {
  for (const side of sides) {
    const text = literalTextOf(side);
    if (text !== null && looksLikeFabricatedMetric(text)) return text;
  }
  return null;
}

// A JsxAttribute's own value, whether written `attr="x"` (StringLiteral
// initializer directly) or `attr={x}` (JsxExpression wrapping the real
// expression).
function attrLiteralText(attr) {
  if (!attr.initializer) return null;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
    return literalTextOf(attr.initializer.expression);
  }
  return null;
}

function findAttr(attributes, name) {
  return attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name && p.name.text === name);
}

function findObjectProp(objectLiteral, name) {
  return objectLiteral.properties.find(
    (p) =>
      ts.isPropertyAssignment(p) &&
      ((ts.isIdentifier(p.name) && p.name.text === name) || (ts.isStringLiteral(p.name) && p.name.text === name)),
  );
}

export function checkStatTileLiteralViolations(source, fileName = "fixture.tsx") {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = source.split("\n");
  const violations = [];

  function lineOf(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line; // 0-based
  }

  function reportIfFabricated(tagName, valueText, labelText, node) {
    if (!looksLikeFabricatedMetric(valueText)) return;
    const line0 = lineOf(node);
    if (hasStaticReferenceMarker(lines, line0)) return;
    violations.push({
      line: line0 + 1,
      tagName,
      snippet: (lines[line0] ?? "").trim().slice(0, 160),
      reason:
        `<${tagName}>'s value prop is a hardcoded literal ("${valueText}")` +
        (labelText ? ` (label: "${labelText}")` : "") +
        `, not a data-bound expression`,
    });
  }

  function visitJsxOpening(tagName, attributes) {
    if (!STAT_TILE_NAME_RE.test(tagName)) return;

    // Rule A: <StatCard ... value="33" /> / value={33} / value={"33"}
    const valueAttr = findAttr(attributes, "value");
    if (valueAttr) {
      const valueText = attrLiteralText(valueAttr);
      if (valueText !== null) {
        const labelAttr = findAttr(attributes, "label");
        const labelText = labelAttr ? (attrLiteralText(labelAttr) ?? undefined) : undefined;
        reportIfFabricated(tagName, valueText, labelText, valueAttr);
      }
    }

    // Rule B: <StatCardGrid items={[{ label: "...", value: "33" }, ...]} />
    // Deliberately inline-array-only — see header's "deliberately does not
    // catch" for why a variable-bound array is out of scope here.
    for (const attrName of ["items", "stats"]) {
      const arrAttr = findAttr(attributes, attrName);
      if (!arrAttr || !arrAttr.initializer || !ts.isJsxExpression(arrAttr.initializer)) continue;
      const arrExpr = arrAttr.initializer.expression;
      if (!arrExpr || !ts.isArrayLiteralExpression(arrExpr)) continue;
      for (const el of arrExpr.elements) {
        if (!ts.isObjectLiteralExpression(el)) continue;
        const valueProp = findObjectProp(el, "value");
        if (!valueProp) continue;
        const valueText = literalTextOf(valueProp.initializer);
        if (valueText === null) continue;
        const labelProp = findObjectProp(el, "label");
        const labelText = labelProp ? (literalTextOf(labelProp.initializer) ?? undefined) : undefined;
        reportIfFabricated(tagName, valueText, labelText, valueProp);
      }
    }
  }

  function visit(node) {
    if (ts.isJsxSelfClosingElement(node)) {
      visitJsxOpening(node.tagName.getText(sourceFile), node.attributes);
    } else if (ts.isJsxOpeningElement(node)) {
      visitJsxOpening(node.tagName.getText(sourceFile), node.attributes);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

// ── 3. Baseline (ratchet) ────────────────────────────────────────────────────

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set();
  let raw;
  try {
    raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (e) {
    console.error(`${RED}FAILED: ${relative(REPO_ROOT, BASELINE_PATH)} is not valid JSON — ${e.message}${RESET}`);
    process.exit(1);
  }
  if (!Array.isArray(raw.entries)) {
    console.error(
      `${RED}FAILED: ${relative(REPO_ROOT, BASELINE_PATH)} is malformed — \`entries\` must be an array.${RESET}\n` +
        `  Regenerate it with: node scripts/ci/stat-tile-literal-guard.mjs --write-baseline`,
    );
    process.exit(1);
  }
  return new Set(raw.entries);
}

// ── 4. Run ────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const writeMode = args.includes("--write-baseline");
  const reportMode = args.includes("--report");

  const files = discoverSourceFiles();
  const allViolations = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const source = readFileSync(file, "utf8");
    const violations = checkStatTileLiteralViolations(source, file);
    for (const v of violations) {
      allViolations.push({ file, rel, key: `${rel}:${v.line}:${v.tagName}`, ...v });
    }
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`${BOLD}${CYAN}Stat-tile literal guard${RESET} — ${files.length} files scanned`);
  console.log(`  Live violations: ${allViolations.length}`);
  console.log("");

  if (writeMode) {
    const entries = allViolations.map((v) => v.key).sort();
    let prevComment;
    try {
      prevComment = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))._comment;
    } catch {
      prevComment = undefined;
    }
    const baseline = {
      _comment:
        prevComment ??
        "TRACKED DEBT, not an approved state. Each entry is a <file>:<line>:<tag> where a " +
          "stat-tile-shaped component (StatCard/StatCardGrid/...) is passed a hardcoded " +
          "numeric/percentage literal for its value prop instead of a data-bound " +
          "expression (see #1472's sa-dashboard fix for the exemplar defect this guards " +
          "against). The gate fails on NEW entries and on stale entries (fixed, or never " +
          "real, but still listed). Burn these down; regenerate with --write-baseline " +
          "after a real fix, same convention as raw-status-leak-baseline.json / " +
          "jsx-a11y-baseline.json.",
      generatedAt: new Date().toISOString().slice(0, 10),
      count: entries.length,
      entries,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`  ${GREEN}Wrote ${entries.length} entries to ${relative(REPO_ROOT, BASELINE_PATH)}${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  if (reportMode) {
    for (const v of allViolations) {
      console.log(`  ${YELLOW}[VIOLATION]${RESET} ${v.key} — ${v.reason}`);
      console.log(`      ${DIM}${v.snippet}${RESET}`);
    }
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  const baselineKeys = readBaseline();
  const currentKeys = new Set(allViolations.map((v) => v.key));
  const novel = allViolations.filter((v) => !baselineKeys.has(v.key));
  const stale = [...baselineKeys].filter((k) => !currentKeys.has(k)).sort();
  const knownDebt = allViolations.filter((v) => baselineKeys.has(v.key));

  if (allViolations.length > 0) {
    for (const v of allViolations) {
      const isNew = !baselineKeys.has(v.key);
      const tag = isNew ? `  ${RED}<-- NEW, not in baseline${RESET}` : "";
      console.log(`  ${isNew ? RED : YELLOW}[STAT-TILE-LITERAL]${RESET} ${v.key}${tag} — ${v.reason}`);
      console.log(`      ${DIM}${v.snippet}${RESET}`);
    }
    console.log("");
  }

  let failed = false;

  if (novel.length > 0) {
    console.log(`  ${RED}${BOLD}FAIL${RESET} — ${novel.length} NEW violation(s) not in the checked-in baseline (marked above).`);
    console.log(`  ${RED}Fix: bind the value to the real loader/prop data, or "—" when it's genuinely unavailable.${RESET}`);
    console.log(`  ${RED}A deliberately static, tenant-invariant constant can be kept with a "static reference" comment.${RESET}`);
    failed = true;
  }

  if (stale.length > 0) {
    console.log(
      `  ${RED}${BOLD}FAIL${RESET} — ${stale.length} baselined entr${stale.length === 1 ? "y" : "ies"} ` +
        `no longer match a live violation:`,
    );
    for (const k of stale) console.log(`      ${GREEN}${k}${RESET}  (fixed, or never real — remove from baseline)`);
    console.log(`  ${RED}Regenerate: node scripts/ci/stat-tile-literal-guard.mjs --write-baseline${RESET}`);
    failed = true;
  }

  if (!failed) {
    console.log(`  ${GREEN}${BOLD}PASS${RESET} — no new violations (${knownDebt.length} tracked debt entries remain).`);
  }
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
