#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// empty-vs-error-guard.mjs — a fetch failure must never render as "you have
// no data yet" (UX-001).
//
// THE DEFECT THIS CATCHES
// ------------------------
// apps/web/src/app/_data/apiClient.ts's fetchJson() never throws: on any
// failure (missing config, missing auth, non-2xx, bad payload, network error)
// it resolves { data: empty, source: "error" }. Individual page.tsx files
// then decide what to render by checking data.length === 0 (or an equivalent
// "is there anything to show" check) — and, in the large majority measured
// by the 2026-09-07 audit, NEVER also looked at `source`. A real outage and a
// tenant with genuinely zero rows render pixel-identical: zero stat cards, a
// cheerful "create your first…" prompt.
//
// CHECK: for every apps/web/src/app/**/page.tsx, for each empty-check
// (`.length === 0`, the most common shape; `Object.keys(x).length === 0`
// matches too), the file must show evidence that THAT SPECIFIC empty-check is
// actually gated by the loader's error token — not merely that an
// error-aware token exists *somewhere* in the file. "Gated by" means one of:
//   - an enclosing ternary/`if` whose OWN test (or whose sibling branch, e.g.
//     an `<ErrorState>`/`<RefreshErrorState>` rendered in the branch not
//     containing the empty-check) references the error token, at any level
//     of nesting outward from the empty-check up to the component boundary;
//   - an earlier sibling `if (<error token>) { return/throw … }` in the same
//     enclosing block (an early-return guard covers everything after it).
// The error token is any of:
//   source === "error" | status === "error" | \berrored\b
//   useResource(...) | combineResourceState(...)
//   <ErrorState | <RefreshErrorState
//
// PRIOR VERSION OF THIS CHECK (fixed 2026-09 after an independent review of
// PR #1127): used `ERROR_AWARE_RE.test(source)` — the error token anywhere in
// the WHOLE FILE suppressed every empty-check in that file. That produced a
// real false negative: `citizen/grievances/page.tsx`,
// `finance/budget/revised-estimates/page.tsx`, and `workflow/page.tsx` each
// had an error-aware token completely disconnected from their actual
// empty-check (e.g. `actions={source === "error" ? <DataSourceBadge/> :
// null}` in a page header, gating nothing, while the real
// `results.length === 0` empty-check a few lines away in a different JSX
// subtree had no error handling at all) — exactly the UX-001 bug, missed by
// the guard meant to catch it. Confirmed two ways: running the file-level
// version against the true pre-fix parent commit found 58 violations, not
// the 61 actually present; toggling the file-level check off entirely (i.e.
// always requiring a *local* check) went from 50 violations to 0 detected as
// "clean by file-level co-occurrence" — proving the file-level test, not the
// empty-check regex, was the mechanism hiding real bugs.
//
// This version parses each file with the TypeScript compiler API (already a
// project dependency; no other scripts/ci guard needed real TSX AST analysis
// before this one — money-precision-guard.mjs and arch-guard.mjs stay
// text/regex-based because their checks genuinely are file-shape questions,
// not "does this specific branch gate that specific branch" questions) and
// requires the error token to be structurally connected to the specific
// empty-check it's supposed to protect, per the "gated by" rule above. It is
// still not full data-flow analysis (it does not trace a boolean through
// arbitrary helper functions), but it is no longer fooled by an error token
// that merely coexists in the file.
//
// Suppress a specific line with a `// ux-001-ok: <reason>` comment on the
// same line as the empty-check, for the rare page whose empty-check has
// nothing to do with a remote fetch (e.g. a purely client-derived/local
// computation with no loader in the picture).
//
// RATCHET, NOT A FULL GATE: this fix's first tranche closes the 5 pages named
// in the gap plus a further batch (see docs/ENTERPRISE-GAP-REPORT-2026-09-07
// UX-001 and its follow-up for the remainder). Failing CI on the whole
// backlog immediately would block every unrelated web PR fleet-wide, so —
// exactly like scripts/ci/tenant-index-guard.mjs and schema-drift-guard.mjs —
// known violations are tracked in a baseline file and do not fail the build;
// the gate is on NEW violations (a newly written page with the same bug) and
// on stale baseline entries (a page fixed but left listed, so a real fix
// can't be silently reverted for free without anyone noticing the baseline
// disagrees).
//
// Usage:
//   node scripts/ci/empty-vs-error-guard.mjs                 # guard: exit 1 on
//                                                              # new/stale baseline entries
//   node scripts/ci/empty-vs-error-guard.mjs --report         # print full violation list,
//                                                              # does not affect exit code
//   node scripts/ci/empty-vs-error-guard.mjs --write-baseline # regenerate the baseline from
//                                                              # the current tree
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const APP_DIR = join(REPO_ROOT, "apps", "web", "src", "app");
const BASELINE_PATH = join(__dirname, "empty-vs-error-baseline.json");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "figma-designs"]);

function* walkPageFiles(dir) {
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
      yield* walkPageFiles(full);
    } else if (entry.isFile() && entry.name === "page.tsx") {
      yield full;
    }
  }
}

const EMPTY_CHECK_RE = /\.length\s*===\s*0/g;
// `\berrored\b` is word-bounded (not just `errored`) so this can't match
// inside an unrelated identifier like `erroredItems` once it's scoped down
// to a single conditional's test/branch text instead of the whole file.
const ERROR_AWARE_RE =
  /source\s*===\s*"error"|status\s*===\s*"error"|\berrored\b|useResource\s*\(|combineResourceState\s*\(|<ErrorState|<RefreshErrorState/i;
const SUPPRESS_RE = /ux-001-ok/;

function isFunctionBoundary(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSourceFile(node)
  );
}

function isEmptyCheckBinaryExpr(node) {
  if (!ts.isBinaryExpression(node)) return false;
  if (node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return false;
  EMPTY_CHECK_RE.lastIndex = 0;
  return EMPTY_CHECK_RE.test(node.getText());
}

/** Does `ifStmt`'s `then` branch unconditionally exit (return/throw) without
 * descending into a nested function (a nested function's own return doesn't
 * exit the outer scope)? Used to recognise `if (<error token>) return …;` as
 * an early-return guard covering everything after it in the same block. */
function branchExits(stmt) {
  let exits = false;
  (function visit(node) {
    if (exits || !node) return;
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) {
      exits = true;
      return;
    }
    if (isFunctionBoundary(node)) return; // don't cross into a nested function
    ts.forEachChild(node, visit);
  })(stmt);
  return exits;
}

function textHasErrorToken(node) {
  return !!node && ERROR_AWARE_RE.test(node.getText());
}

function ifStatementIsErrorGuardWithExit(ifStmt) {
  return textHasErrorToken(ifStmt.expression) && branchExits(ifStmt.thenStatement);
}

/** Within `block`, is there an `if (<error token>) { return/throw }` sibling
 * statement strictly before `beforeStatement`? Such a guard covers every
 * statement after it in the same block, including a `return (<jsx>)` further
 * down that contains our empty-check. */
function hasEarlyReturnGuardBefore(block, beforeStatement) {
  const idx = block.statements.indexOf(beforeStatement);
  if (idx <= 0) return false;
  for (let i = 0; i < idx; i++) {
    const stmt = block.statements[i];
    if (ts.isIfStatement(stmt) && ifStatementIsErrorGuardWithExit(stmt)) return true;
  }
  return false;
}

/** Find the direct statement-list child of `block` that contains (or is)
 * `node`, so we can locate it among its siblings. */
function findContainingStatement(block, node) {
  return block.statements.find((s) => s.getStart() <= node.getStart() && s.getEnd() >= node.getEnd());
}

/**
 * Walk up from `emptyCheckNode` to its enclosing component/function boundary,
 * looking for evidence that THIS empty-check — not just the file in general —
 * is gated by the loader's error token. See the "gated by" rule in the header
 * comment. Returns true iff such evidence is found.
 *
 * KNOWN LIMITATION (tracked in UX-013): stops at the nearest enclosing
 * function boundary without checking whether that function is itself an
 * argument to `useResource(...)`/`combineResourceState(...)` -- this repo's
 * blessed error-handling contract. A page using that contract correctly can
 * still show as a false-positive violation here (e.g. workflow/page.tsx,
 * workflow/definitions/page.tsx). Extend this to recognize that call shape
 * as a valid connection before relying on a zero baseline count.
 */
function isConnectedToErrorAwareness(emptyCheckNode) {
  let node = emptyCheckNode;

  while (node.parent) {
    const parent = node.parent;

    if (ts.isConditionalExpression(parent)) {
      if (textHasErrorToken(parent.condition)) return true;
      // The branch NOT containing `node` is a sibling render path of the same
      // ternary — e.g. `errored ? <RefreshErrorState/> : (…our empty-check…)`
      // already matches via `condition` above, but also cover
      // `hasError ? <ErrorState/> : (…our empty-check…)` where the JSX
      // component name itself (not the condition's own text) is the signal.
      const sibling = parent.whenTrue.getStart() <= node.getStart() && parent.whenTrue.getEnd() >= node.getEnd()
        ? parent.whenFalse
        : parent.whenTrue;
      if (textHasErrorToken(sibling)) return true;
    }

    if (ts.isIfStatement(parent)) {
      if (textHasErrorToken(parent.expression)) return true;
      const inThen = parent.thenStatement.getStart() <= node.getStart() && parent.thenStatement.getEnd() >= node.getEnd();
      const otherBranch = inThen ? parent.elseStatement : parent.thenStatement;
      if (textHasErrorToken(otherBranch)) return true;
    }

    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (textHasErrorToken(parent.left)) return true;
    }

    if (ts.isBlock(parent)) {
      const stmt = findContainingStatement(parent, node);
      if (stmt && hasEarlyReturnGuardBefore(parent, stmt)) return true;
    }

    if (isFunctionBoundary(parent)) break;
    node = parent;
  }

  return false;
}

/**
 * Pure check, exported for fixture-based unit tests (see
 * tests/architecture/empty-vs-error-guard.test.ts) — mirrors the
 * "exported functions + optional CLI entrypoint" shape used by
 * tenant-router-guard.mjs, so this can be exercised with in-memory source
 * strings instead of requiring real fixture files on disk.
 *
 * Returns the list of offending {line, snippet} empty-checks, or null when
 * the source is clean (no empty-check at all, or every empty-check is
 * individually gated by the loader's error token per isConnectedToErrorAwareness()).
 */
export function checkSource(source) {
  const sourceFile = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TSX);
  const lines = source.split("\n");

  // line (0-based) -> { line: 1-based, snippet, connected }
  const byLine = new Map();

  (function visit(node) {
    if (isEmptyCheckBinaryExpr(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const lineText = lines[line] ?? "";
      if (!SUPPRESS_RE.test(lineText)) {
        const connected = isConnectedToErrorAwareness(node);
        const existing = byLine.get(line);
        if (!existing) {
          byLine.set(line, { line: line + 1, snippet: lineText.trim().slice(0, 140), connected });
        } else if (connected) {
          // Any connected occurrence on the same line clears it.
          existing.connected = true;
        }
      }
    }
    ts.forEachChild(node, visit);
  })(sourceFile);

  if (byLine.size === 0) return null;

  const emptyCheckLines = [...byLine.values()]
    .filter((entry) => !entry.connected)
    .sort((a, b) => a.line - b.line)
    .map(({ line, snippet }) => ({ line, snippet }));

  return emptyCheckLines.length === 0 ? null : emptyCheckLines;
}

function analyzeFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  return checkSource(source);
}

function discoverViolations() {
  const violations = new Map(); // relPath -> emptyCheckLines
  let filesScanned = 0;
  if (!existsSync(APP_DIR)) return { violations, filesScanned };

  for (const file of walkPageFiles(APP_DIR)) {
    filesScanned++;
    const emptyCheckLines = analyzeFile(file);
    if (emptyCheckLines) {
      violations.set(relative(REPO_ROOT, file), emptyCheckLines);
    }
  }
  return { violations, filesScanned };
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { files: new Set(), raw: null };
  const raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  return { files: new Set(raw.knownViolations ?? []), raw };
}

function writeBaseline(files) {
  const sorted = [...files].sort();
  const content = {
    $comment:
      "TRACKED DEBT, not an approved state. Each entry is a page.tsx with a " +
      ".length === 0 (or equivalent) empty-check and no evidence anywhere in " +
      "the file that it also branches on the loader's error token — see " +
      "scripts/ci/empty-vs-error-guard.mjs for the exact check. The gate " +
      "fails on NEW violations and on stale entries (fixed but left listed). " +
      "Burn these down; regenerate with --write-baseline after a real fix. " +
      "See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-001 (first tranche) " +
      "and its follow-up (UX-013) for the remainder.",
    generatedAt: new Date().toISOString().slice(0, 10),
    knownViolations: sorted,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(content, null, 2) + "\n");
  return sorted;
}

function main() {
  const args = process.argv.slice(2);
  const writeMode = args.includes("--write-baseline");
  const reportMode = args.includes("--report");

  const { violations, filesScanned } = discoverViolations();
  const currentFiles = new Set(violations.keys());

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Empty-vs-Error Guard — fetch failure vs genuinely-empty (UX-001)");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  page.tsx files scanned: ${filesScanned}`);
  console.log(`  Currently violating:    ${currentFiles.size}`);
  console.log("");

  if (writeMode) {
    const sorted = writeBaseline(currentFiles);
    console.log(`  ${GREEN}Wrote baseline with ${sorted.length} known violation(s) to${RESET}`);
    console.log(`  ${DIM}${relative(REPO_ROOT, BASELINE_PATH)}${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  if (reportMode) {
    for (const [file, lines] of [...violations.entries()].sort()) {
      console.log(`  ${YELLOW}[VIOLATION]${RESET} ${file}`);
      for (const l of lines) {
        console.log(`      ${DIM}${l.line}: ${l.snippet}${RESET}`);
      }
    }
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  const { files: baselineFiles } = loadBaseline();
  const newViolations = [...currentFiles].filter((f) => !baselineFiles.has(f)).sort();
  const staleEntries = [...baselineFiles].filter((f) => !currentFiles.has(f)).sort();

  if (newViolations.length === 0 && staleEntries.length === 0) {
    console.log(`  ${GREEN}✅ PASS — matches baseline (${baselineFiles.size} tracked, 0 new).${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  if (newViolations.length > 0) {
    console.log(`  ${RED}${BOLD}❌ ${newViolations.length} NEW violation(s) not in the baseline:${RESET}`);
    for (const f of newViolations) {
      const lines = violations.get(f);
      console.log(`  ${RED}[NEW]${RESET} ${f}`);
      for (const l of lines) {
        console.log(`      ${DIM}${l.line}: ${l.snippet}${RESET}`);
      }
    }
    console.log("");
  }

  if (staleEntries.length > 0) {
    console.log(`  ${RED}${BOLD}❌ ${staleEntries.length} stale baseline entr(y/ies) — fixed but left listed:${RESET}`);
    for (const f of staleEntries) {
      console.log(`  ${RED}[STALE]${RESET} ${f}`);
    }
    console.log(`  ${CYAN}Regenerate with: node scripts/ci/empty-vs-error-guard.mjs --write-baseline${RESET}`);
    console.log("");
  }

  console.log(
    `  ${RED}Fix: branch on the loader's source/status (useResource/combineResourceState,${RESET}`,
  );
  console.log(
    `  ${RED}<ErrorState>/<RefreshErrorState>) before deciding "empty", or suppress a${RESET}`,
  );
  console.log(`  ${RED}genuinely unrelated line with // ux-001-ok: <reason>.${RESET}`);
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(1);
}

// Only run the CLI when invoked directly (`node scripts/ci/empty-vs-error-guard.mjs`),
// not when imported by tests/architecture/empty-vs-error-guard.test.ts for checkSource().
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
