#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// nested-tx-guard.mjs — TX-011: replaces the ad-hoc, not-checked-in
// `/tmp/scan_nested_tx_v2.py` that TX-001's sweep used, closing its three
// documented blind spots so the fleet has a durable, gated scanner instead of
// a one-off script that no longer exists on disk.
//
// THE DEFECT THIS CATCHES (same risk class as TX-001)
// -----------------------------------------------------
// Every service wraps tenant-scoped DB work in one of three ways:
//   - `db.transaction(async (tx) => { ... })`               (writes; also
//     `defaultDb.transaction(`, `primaryDb.transaction(` on services with an
//     alternate handle — see the fleet-wide receiver census below)
//   - `tenantTransaction(db, tenantId, async (tx) => { ... })`  (`@civitasone/db`)
//   - `scopedRead(async (tx) => { ... })`                    (per-service
//     `src/shared/db.ts`, read-only)
// All three check out ONE connection from the pool for the lifetime of the
// callback. If, while that callback is still running, ANY code path it
// reaches — directly, or through one or more local function calls — opens a
// SECOND one of these on the SAME logical request, that second checkout has
// no free connection to draw on once concurrent traffic reaches pool.max,
// and deadlocks the pool silently (no exception; the request just hangs
// until it times out). TX-001 found and fixed 84 real instances of this
// fleet-wide by routing the nested call through a caller-supplied `tx`
// instead (the `...Tx(tx, ...)` sibling convention — e.g.
// `getOverdueApplicationIdsTx`, `getStepDefinitionsTx`).
//
// TX-011's three named blind spots in the scanner TX-001's sweep used, and
// how this file closes each one:
//
//   1. "ignores `export const … = async` repos" — a scanner that only
//      recognizes `function foo(...) {` headers never even sees a repo
//      function written `export const foo = async (...) => { ... }` as a
//      callable unit — not as a potential outer wrapper, not as a call-graph
//      node to look inside when checking a caller's callee. `findFunctionDefinitions()`
//      below matches BOTH `(export )?(async )?function name(` and
//      `(export )?const name = (async )?(` (block-bodied arrows only — see
//      its own doc comment), so both styles are indexed identically.
//
//   2. "`tenantTransaction`/`scopedRead` as the *outer* block" — the old
//      scanner apparently only ever treated these two names as evidence of
//      NESTING (i.e. "we're already inside a transaction if we see one of
//      these"), never as themselves establishing a fresh outer scope worth
//      inspecting for further nested opens. That is exactly why it missed
//      grant-service's `getDashboard()`: its outer wrapper is `scopedRead(`,
//      not `db.transaction(`, so a scanner that never treats `scopedRead(`
//      as an outer opener never looks inside its callback at all — the
//      violation inside was invisible regardless of depth. This file makes
//      NO distinction between "outer" and "inner" call shapes: every match
//      of `isOpenerCall()` (`tenantTransaction(`, `scopedRead(`, or
//      `<ident ending in db/Db>.transaction(`) is simultaneously (a) checked
//      as a possible nested violation if it occurs inside another opener's
//      reach, and (b) treated as its own fresh root whose callback is itself
//      scanned for further nested opens. See the fleet-wide receiver census
//      below for why `tx.transaction(` is deliberately EXCLUDED — a
//      same-connection savepoint, not a new pool checkout.
//
//   3. ">1-level transitive calls" (grant `dashboard/queries.ts:71`, and
//      TX-001's own install-service note: "2 of them reachable only
//      transitively via a locally-defined `resolveDag()` helper") — the old
//      scanner apparently only checked a callback's own body text, not what
//      its callees' callees do. `reachesOpener()` below does a cycle-safe
//      breadth-first walk of the per-service call graph with NO fixed depth
//      cutoff: every call in an opener's callback is resolved (same-file
//      definition, a named import, or a namespace import — see
//      `resolveCall()`) and if the resolved function doesn't itself open a
//      transaction, ITS calls are resolved and checked too, and so on, using
//      a visited-set to make recursive/cyclic call graphs safe. A fixed
//      depth (e.g. "check 2 levels") would just relocate this exact blind
//      spot to level 3 — TX-001's own install-service finding was already 2
//      hops deep (`resolveDag()` → `repo.getStepDefinitionsTx`), and nothing
//      about this fleet's call graphs bounds how much deeper a real one
//      could be. The traversal is bounded by the call graph itself (finite,
//      cycle-guarded), not by an arbitrary constant — "as deep as is
//      practical" here means "as deep as the real code goes."
//
//   4. (Found necessary during this file's own first fleet-wide run, not one
//      of TX-011's three named blind spots, but the same spirit — see §5b
//      below, "Dual-mode-helper refinement", for the full writeup.) This
//      fleet also has functions that are deliberately SAFE to call from
//      inside an existing transaction, PROVIDED the caller passes its own
//      `tx` — e.g. `sumDisbursedForApplication(tx, ...)` only opens its own
//      `scopedRead()` in an `if (tx === db)` fallback branch that is dead
//      whenever a real `tx` is passed, exactly as grant-service's own call
//      site does. A purely textual scan cannot see that the open is
//      unreachable there without a value the caller actually passed — two
//      confirmed instances of this shape were this scanner's only false
//      positives on its first full-fleet run. §5b closes the specific,
//      narrow case of it (an opener call gated on the function's OWN
//      parameter) without attempting real dataflow analysis.
//
// SCOPE: "within the same service" (per this gap's own DoD). The call graph
// is built and walked separately per `services/*-service/` directory — the
// Architecture Guard's own "no cross-service imports" rule
// (`.github/workflows/ci.yml`, "Check no cross-service DB joins") means a
// cross-service call graph edge should never exist anyway; scoping per
// service keeps the graph small and keeps two unrelated services' identically-
// named helpers (e.g. many services have their own local `emit()`) from ever
// being confused for one another.
//
// FEnceT-WIDE RECEIVER CENSUS (informs `DB_HANDLE_RE` below) — the ONLY
// receivers of a bare `.transaction(` call anywhere in `services/*/src` as of
// 2026-09-13 (`grep -rhoE "[A-Za-z_$][A-Za-z0-9_$]*\.transaction\(" services/*/src`):
// `db` (3372×), `tx` (3×), `defaultDb` (2×), `primaryDb` (1×). `tx.transaction(`
// is drizzle's SAVEPOINT form — it reuses the transaction's own already-held
// connection, so it cannot deadlock the pool the way a second, independent
// checkout can; it is a different risk class and out of this gap's scope, so
// it is the one receiver deliberately NOT matched.
//
// NOT attempted (parser, not a full type-checker): destructured/renamed
// re-exports through a barrel file, dynamic `import()`, method-shorthand
// object exports (`export const repo = { foo: async () => {} }`), and a
// concise-body arrow (`const f = (x) => expr`) are not indexed as call-graph
// nodes — none of this fleet's repo/handler functions are written that way
// today (all are `function foo(...) { }` or block-bodied
// `const foo = async (...) => { }`), so this narrows FALSE NEGATIVES only
// (a call this scanner can't resolve is silently not traversed further), the
// same "under- rather than over-report" trade every other guard in this
// directory makes (see e.g. raw-status-leak-guard.mjs's doc comment). A
// resolvable call that turns out safe is never mis-flagged by this trade.
//
// RATCHET: keyed-entry baseline (mirrors tenant-table-rls-guard.mjs /
// tenant-index-guard.mjs), NOT the maxViolations-count style
// (raw-status-leak-guard.mjs) — TX-001 claims 0 genuine sites remain
// fleet-wide, so this gap's own DoD is "baseline 0 after TX-001", and a
// per-callsite baseline lets a real new finding be reviewed and named
// individually rather than hidden behind a number. If this scanner's first
// real run finds anything, that is a genuine, separate finding — see this
// file's own PR description / the gap-report row this was written to close.
//
// Usage:
//   node scripts/ci/nested-tx-guard.mjs                 # guard: exit 1 on
//                                                         # new/stale baseline entries
//   node scripts/ci/nested-tx-guard.mjs --write-baseline # regenerate the baseline
//                                                         # from the current tree
//   node scripts/ci/nested-tx-guard.mjs <service>        # limit to one service
//                                                         # (e.g. "grant-service")
//
// No live database needed — pure source-text analysis, so (like
// tenant-table-rls-guard.mjs) this runs in the arch-guard job, not the
// Bootstrap Postgres job.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, dirname as pathDirname } from "node:path";
import posixPath from "node:path/posix";
import { fileURLToPath } from "node:url";

const __dirname = pathDirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");
const BASELINE_FILE = join(__dirname, "nested-tx-baseline.json");

const WRITE_BASELINE = process.argv.includes("--write-baseline");
const only = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// ── 1. Source cleaning ───────────────────────────────────────────────────────
// Produces a SAME-LENGTH string in which every comment and the *contents* of
// every string/template/regex literal are replaced with spaces (newlines
// preserved, so line numbers computed against either string agree). A
// template literal's `${ ... }` interpolation is real code — e.g. this
// fleet's drizzle `sql`ANY(${lockedIds}::uuid[])`` tags are everywhere — so
// its contents are recursively cleaned and kept, not blanked. Every later
// regex/brace-walk in this file runs against the CLEANED text, so a stray
// `(`/`{` inside a string or comment (e.g. an error message "failed (see
// logs)") can never desync a paren/brace count. Import-path extraction
// (section 4) is the one thing that deliberately reads the ORIGINAL text
// instead, since it needs the literal quoted path.
export function cleanSource(text) {
  const out = new Array(text.length);

  function isRegexContext(i) {
    let j = i - 1;
    while (j >= 0 && /\s/.test(text[j])) j--;
    if (j < 0) return true;
    const c = text[j];
    if (/[)\]]/.test(c)) return false;
    if (/[A-Za-z0-9_$]/.test(c)) {
      let k = j;
      while (k >= 0 && /[A-Za-z0-9_$]/.test(text[k])) k--;
      const word = text.slice(k + 1, j + 1);
      const KEYWORDS = new Set([
        "return", "typeof", "instanceof", "in", "of", "new", "delete",
        "void", "throw", "case", "yield", "do", "else",
      ]);
      return KEYWORDS.has(word);
    }
    return true;
  }

  // Cleans exactly one comment/string/template/regex/plain-char starting at
  // i, writing into `out`, and returns the index to resume at.
  function cleanOne(i) {
    const c = text[i], c2 = text[i + 1];
    if (c === "/" && c2 === "/") {
      let j = i;
      while (j < text.length && text[j] !== "\n") { out[j] = " "; j++; }
      return j;
    }
    if (c === "/" && c2 === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let j = i; j < stop; j++) out[j] = text[j] === "\n" ? "\n" : " ";
      return stop;
    }
    if (c === '"' || c === "'") {
      out[i] = c;
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") { out[j] = " "; if (j + 1 < text.length) out[j + 1] = " "; j += 2; continue; }
        if (text[j] === c) { out[j] = c; j++; break; }
        out[j] = text[j] === "\n" ? "\n" : " ";
        j++;
      }
      return j;
    }
    if (c === "`") {
      out[i] = "`";
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") { out[j] = " "; if (j + 1 < text.length) out[j + 1] = " "; j += 2; continue; }
        if (text[j] === "`") { out[j] = "`"; j++; break; }
        if (text[j] === "$" && text[j + 1] === "{") {
          out[j] = "$"; out[j + 1] = "{";
          j = cleanBalanced(j + 2, "{", "}");
          continue;
        }
        out[j] = text[j] === "\n" ? "\n" : " ";
        j++;
      }
      return j;
    }
    if (c === "/" && isRegexContext(i)) {
      let j = i + 1, inClass = false;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "\n") break;
        if (text[j] === "[") inClass = true;
        else if (text[j] === "]") inClass = false;
        else if (text[j] === "/" && !inClass) { j++; break; }
        j++;
      }
      while (j < text.length && /[a-zA-Z]/.test(text[j])) j++;
      for (let k = i; k < j; k++) out[k] = " ";
      return j;
    }
    out[i] = c;
    return i + 1;
  }

  // Cleans forward from i (just past an already-written opening delim) up
  // to and including the matching close delim at depth 0, preserving real
  // code the whole way (used for template `${ ... }` interpolations).
  function cleanBalanced(i, openCh, closeCh) {
    let depth = 1;
    while (i < text.length) {
      const c = text[i];
      if (c === openCh) { out[i] = c; depth++; i++; continue; }
      if (c === closeCh) { out[i] = c; depth--; i++; if (depth === 0) return i; continue; }
      i = cleanOne(i);
    }
    return i;
  }

  let i = 0;
  while (i < text.length) i = cleanOne(i);
  return out.join("");
}

// ── 2. Balanced-delimiter matching (runs on CLEANED text only — see above,
//    every dangerous character is already blanked, so a plain linear scan
//    is safe and correct). ────────────────────────────────────────────────
function findMatchingClose(clean, openIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = openIdx; i < clean.length; i++) {
    const c = clean[i];
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Finds the `{` that opens a function/arrow body, skipping over a possible
// TS return-type annotation between the parameter list's `)` and the body
// (`): Promise<Foo[]> {`) by tracking angle/paren/bracket nesting so a
// generic's `<`/`>` or an array return type's `[]` can't be mistaken for the
// body brace. For an arrow, also requires finding `=>` first. Returns
// `{ bodyBraceIdx }` or `null` if this isn't a block-bodied definition
// (an overload signature, a concise-body arrow, etc. — see this file's top
// doc comment on what is deliberately not indexed).
function findBodyBrace(clean, afterCloseParenIdx, { requireArrow }) {
  let i = afterCloseParenIdx + 1;
  let angle = 0, paren = 0, bracket = 0;
  let sawArrow = !requireArrow;
  while (i < clean.length) {
    const c = clean[i];
    if (c === "<") angle++;
    else if (c === ">") { if (angle > 0) angle--; }
    else if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "[") bracket++;
    else if (c === "]") bracket--;
    else if (requireArrow && !sawArrow && c === "=" && clean[i + 1] === ">" && angle === 0 && paren === 0 && bracket === 0) {
      sawArrow = true;
      i += 2;
      continue;
    } else if (sawArrow && c === "{" && angle === 0 && paren === 0 && bracket === 0) {
      return { bodyBraceIdx: i };
    } else if ((c === ";" || c === ",") && angle === 0 && paren === 0 && bracket === 0) {
      return null;
    }
    i++;
  }
  return null;
}

// ── 3. Function-definition discovery: both named-blind-spot styles ─────────
// `(export )?(async )?function name(` AND `(export )?const name = (async )?(`
// (arrow, block-bodied only). Returns one entry per definition:
// { name, bodyStart, bodyEnd, paramNames } (bodyEnd exclusive, just past the
// closing `}`; paramNames feeds the dual-mode-helper refinement below).
const FUNCTION_DECL_SRC = String.raw`\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(`;
const ARROW_CONST_SRC = String.raw`\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(`;

// Leading identifier of each top-level (depth-0) comma-separated parameter,
// e.g. "tx: Writer, tenantId: string" -> ["tx", "tenantId"]; "tx?: Writer"
// -> ["tx"]; a destructured param ("{ a, b }") is skipped, not expanded --
// this only feeds a name-based heuristic (see findUnconditionalOpener), and
// a param this can't name simply can't suppress anything, which is the
// safe direction for it to fail in.
function extractParamNames(paramsText) {
  const names = [];
  let depth = 0, start = 0;
  const parts = [];
  for (let i = 0; i < paramsText.length; i++) {
    const c = paramsText[i];
    if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c)) depth--;
    else if (c === "," && depth === 0) { parts.push(paramsText.slice(start, i)); start = i + 1; }
  }
  parts.push(paramsText.slice(start));
  for (const raw of parts) {
    const t = raw.trim();
    if (!t || t.startsWith("{") || t.startsWith("[")) continue;
    const m = t.match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)/);
    if (m) names.push(m[1]);
  }
  return names;
}

export function findFunctionDefinitions(clean) {
  const defs = [];

  const fnRe = new RegExp(FUNCTION_DECL_SRC, "g");
  let m;
  while ((m = fnRe.exec(clean))) {
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = findMatchingClose(clean, parenOpen, "(", ")");
    if (parenClose === -1) continue;
    const body = findBodyBrace(clean, parenClose, { requireArrow: false });
    if (!body) continue;
    const braceClose = findMatchingClose(clean, body.bodyBraceIdx, "{", "}");
    if (braceClose === -1) continue;
    const paramNames = extractParamNames(clean.slice(parenOpen + 1, parenClose));
    defs.push({ name: m[1], bodyStart: body.bodyBraceIdx + 1, bodyEnd: braceClose, paramNames });
  }

  const arrowRe = new RegExp(ARROW_CONST_SRC, "g");
  while ((m = arrowRe.exec(clean))) {
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = findMatchingClose(clean, parenOpen, "(", ")");
    if (parenClose === -1) continue;
    const body = findBodyBrace(clean, parenClose, { requireArrow: true });
    if (!body) continue;
    const braceClose = findMatchingClose(clean, body.bodyBraceIdx, "{", "}");
    if (braceClose === -1) continue;
    const paramNames = extractParamNames(clean.slice(parenOpen + 1, parenClose));
    defs.push({ name: m[1], bodyStart: body.bodyBraceIdx + 1, bodyEnd: braceClose, paramNames });
  }

  return defs;
}

// ── 4. Import discovery (runs on ORIGINAL text — needs the literal quoted
//    path; import statements are simple/single-purpose enough that scanning
//    unclean text is the same pragmatic trade this fleet's other guards make
//    elsewhere, e.g. raw-status-leak-guard.mjs's line-based regexes). ──────
const NAMED_IMPORT_RE = /\bimport\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;
const NAMESPACE_IMPORT_RE = /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/g;

export function findImports(source) {
  const named = new Map(); // localName -> { importedName, path }
  const namespace = new Map(); // localName -> path

  let m;
  const namedRe = new RegExp(NAMED_IMPORT_RE.source, "g");
  while ((m = namedRe.exec(source))) {
    const path = m[2];
    for (const rawSpec of m[1].split(",")) {
      const spec = rawSpec.trim();
      if (!spec) continue;
      const asMatch = spec.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) named.set(asMatch[2], { importedName: asMatch[1], path });
      else if (/^[A-Za-z_$][\w$]*$/.test(spec)) named.set(spec, { importedName: spec, path });
    }
  }
  const nsRe = new RegExp(NAMESPACE_IMPORT_RE.source, "g");
  while ((m = nsRe.exec(source))) namespace.set(m[1], m[2]);

  return { named, namespace };
}

function resolveImportPath(fromFile, spec, fileSet) {
  if (!spec.startsWith(".")) return null; // package import — outside this service's own graph
  const fromDir = posixPath.dirname(fromFile);
  const base = posixPath.normalize(posixPath.join(fromDir, spec)).replace(/\.(js|ts|tsx)$/, "");
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

// ── 5. Opener detection ──────────────────────────────────────────────────────
// See the DB_HANDLE census in this file's top doc comment for why `tx` is
// excluded and `db`/`defaultDb`/`primaryDb`-shaped receivers are included.
// NOTE: the receiver's "ends with db/Db" test is done in JS (String#endsWith
// below), not folded into the regex itself -- a regex like
// `[A-Za-z_$][\w$]*[dD]b` LOOKS like it means "ends with db/Db" but actually
// requires at least 3 characters (one for the mandatory leading class, two
// for the trailing `[dD]b`), so it can never match the plain 2-character
// identifier `db` itself -- the single most common receiver fleet-wide
// (3372 of 3378 `.transaction(` call sites; see the census above). Caught by
// this scanner's own local test suite (a `db.transaction(` fixture silently
// matched 0 openers) before it ever reached the real tree.
const OPENER_RE_SRC = String.raw`\b(tenantTransaction|scopedRead)\s*\(|\b([A-Za-z_$][\w$]*)\.transaction\s*\(`;

function findAllOpeners(clean) {
  const re = new RegExp(OPENER_RE_SRC, "g");
  const hits = [];
  let m;
  while ((m = re.exec(clean))) {
    if (m[1]) {
      hits.push({ index: m.index, name: m[1], callOpenParenIdx: m.index + m[0].length - 1 });
    } else if (m[2].toLowerCase().endsWith("db")) {
      hits.push({ index: m.index, name: `${m[2]}.transaction`, callOpenParenIdx: m.index + m[0].length - 1 });
    }
  }
  return hits;
}

function isOpenerCallText(ns, name) {
  if (!ns) return name === "tenantTransaction" || name === "scopedRead";
  return name === "transaction" && ns.toLowerCase().endsWith("db");
}

// ── 5b. Dual-mode-helper refinement (found necessary against the real tree:
//    see this file's top doc comment's "KNOWN, DELIBERATE IMPRECISION" note)
// ────────────────────────────────────────────────────────────────────────
// This fleet has a real, deliberate THIRD pattern beyond "always opens" vs.
// "always takes tx" -- a dual-mode helper, usable both standalone and
// nested, that only falls back to opening its own transaction when it was
// NOT given a real one, e.g.:
//   export async function upsertBalance(tenantId, itemId, delta, tx?: Writer) {
//     const run = (executor) => { ... };
//     if (tx) return run(tx);
//     return db.transaction((t) => run(t));            // fallback only
//   }
// A purely textual "does this function's body contain an opener call"
// check cannot tell that the `db.transaction(` branch is dead whenever the
// caller passes a real `tx` -- which grant-service's sumDisbursedForApplication
// and estab-service's upsertBalance both do at their only real call sites.
// True per-call-site dataflow (proving what a specific argument actually
// evaluates to) is out of reach for a regex/brace-walking scanner and was
// deliberately not attempted (see the top doc comment's "NOT attempted"
// list) -- but the narrower, self-contained question "is every opener call
// in this function's body reachable only through a branch gated on one of
// the function's OWN parameters" doesn't need dataflow, just the function's
// own text, and directly matches this fleet's actual idiom (confirmed
// against both real false positives this scanner's first fleet-wide run
// produced). A function where EVERY opener call is so guarded is treated as
// never unconditionally opening; an opener call outside any such guard
// still counts (findUnconditionalOpener returns the first one found).
//
// Traded-off risk (documented, not hidden): a function that accepts a
// tx-shaped parameter, checks it, but has an inverted/buggy condition that
// takes the open-transaction branch even when a real tx WAS passed would be
// invisible to this refinement too. This narrows an already rare shape
// further; nothing found in this fleet's first full run exhibited it, and
// the same "prefer a false negative over a false positive" trade this
// file's top doc comment makes elsewhere applies here too.
// True for a braced block `{ ... }` whose LAST statement is a `return` or
// `throw` -- i.e. a block that unconditionally exits the function on every
// path through it (no attempt to see inside an if/else *within* the block;
// a false negative there just means this returns false, which only costs a
// guard that could have been recognized -- errs toward still reporting, see
// this section's opening doc comment). Used below to recognize the REAL
// insertBlacklist/insertBlacklistTx shape: `if (writer) { ...; return X; }`
// with the fallback as a separate statement AFTER the block, not inside an
// `else` -- functionally an early-return guard, just spelled with braces.
function blockEndsInReturnOrThrow(bodyClean, blockStart, blockEnd) {
  let i = blockEnd - 1;
  while (i > blockStart && /\s/.test(bodyClean[i])) i--;
  if (bodyClean[i] !== ";") return false;
  let j = i - 1, depth = 0;
  while (j > blockStart) {
    const c = bodyClean[j];
    if (")]}".includes(c)) depth++;
    else if ("([{".includes(c)) depth--;
    else if (c === ";" && depth === 0) { j++; break; }
    j--;
  }
  if (j <= blockStart) j = blockStart + 1;
  const stmt = bodyClean.slice(j, i + 1).trim();
  return /^return\b/.test(stmt) || /^throw\b/.test(stmt);
}

// Finds every `if (cond) { ... }` in bodyClean. Each entry always carries
// blockStart/blockEnd (for "is this opener INSIDE the block" checks); it
// additionally carries afterIndex when the block itself unconditionally
// returns/throws -- in which case, like a bare early-return guard, anything
// textually AFTER the block in the same function body is only reached when
// `cond` was false (this is exactly the real insertBlacklist shape: a
// braced `if (writer) { ...; return rows[0]!; }` followed by the
// `db.transaction(...)` fallback as the next statement, not an `else`).
function findIfGuards(bodyClean) {
  const guards = [];
  const re = /\bif\s*\(/g;
  let m;
  while ((m = re.exec(bodyClean))) {
    const condOpen = m.index + m[0].length - 1;
    const condClose = findMatchingClose(bodyClean, condOpen, "(", ")");
    if (condClose === -1) continue;
    let i = condClose + 1;
    while (i < bodyClean.length && /\s/.test(bodyClean[i])) i++;
    if (bodyClean[i] !== "{") continue; // brace-less form: handled by findEarlyReturnGuards below
    const blockClose = findMatchingClose(bodyClean, i, "{", "}");
    if (blockClose === -1) continue;
    const condText = bodyClean.slice(condOpen + 1, condClose);
    const entry = { condText, blockStart: i, blockEnd: blockClose };
    if (blockEndsInReturnOrThrow(bodyClean, i, blockClose)) entry.afterIndex = blockClose + 1;
    guards.push(entry);
  }
  return guards;
}

// The other half of the dual-mode-helper idiom, and the shape the REAL
// upsertBalance false positive actually used: an unbraced early-return
// guard clause, `if (tx) return run(tx);`, immediately followed by the
// fallback as a separate, later statement -- `return db.transaction(...)`
// -- rather than a braced if/else. Unlike a braced guard, an early return
// makes EVERYTHING textually after it in the same function body
// unconditionally "condition was false" for the rest of the function's
// control flow (no nesting check needed) -- ASSUMING the guarded parameter
// is never reassigned afterward, which this fleet's short, straight-line
// repo functions never do (not verified separately; a documented,
// accepted limitation, same trade as findIfGuards' braces-only match).
function findEarlyReturnGuards(bodyClean) {
  const guards = [];
  const re = /\bif\s*\(/g;
  let m;
  while ((m = re.exec(bodyClean))) {
    const condOpen = m.index + m[0].length - 1;
    const condClose = findMatchingClose(bodyClean, condOpen, "(", ")");
    if (condClose === -1) continue;
    let i = condClose + 1;
    while (i < bodyClean.length && /\s/.test(bodyClean[i])) i++;
    if (bodyClean[i] === "{") continue; // braced form: handled by findIfGuards above
    const stmt = /^return\b[^;{}]*;/.exec(bodyClean.slice(i));
    if (!stmt) continue; // not a plain "if (cond) return ...;" guard -- bail conservatively (still reportable)
    guards.push({ condText: bodyClean.slice(condOpen + 1, condClose), afterIndex: i + stmt[0].length });
  }
  return guards;
}

// Deliberately narrow (mirrors the "under- rather than over-report"
// philosophy this file's top doc comment and every other guard in this
// directory share): a guard only counts as a dual-mode-tx guard if its
// condition is EXACTLY a bare truthiness check on one of the function's own
// parameters (`tx`, `!tx`) or a bare equality/inequality against another
// bare identifier (`tx === db`, `writer != null`) -- precisely the three
// shapes this fleet's real dual-mode helpers use (`if (tx)`, `if (writer)`,
// `if (tx === db)`). A condition comparing the param to anything else (a
// string/number literal, a method call, a second clause via `&&`/`||`) is
// NOT a tx-presence check and must not suppress an opener -- e.g.
// `if (flag === "special") { db.transaction(...) }` is an ordinary
// conditional that opens a transaction on ONE of two branches, not a
// caller-supplied-tx fallback, even though `flag` happens to be a
// parameter name too. (Caught by this scanner's own local test suite: an
// earlier, looser "condition merely MENTIONS a param name anywhere" version
// wrongly suppressed exactly this shape.)
function isDualModeGuardCondition(condText, paramNames) {
  const trimmed = condText.trim();
  for (const p of paramNames ?? []) {
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`^!?\\s*${esc}\\s*$`).test(trimmed)) return true;
    if (new RegExp(`^${esc}\\s*(===|==|!==|!=)\\s*[A-Za-z_$][\\w$]*\\s*$`).test(trimmed)) return true;
    if (new RegExp(`^[A-Za-z_$][\\w$]*\\s*(===|==|!==|!=)\\s*${esc}\\s*$`).test(trimmed)) return true;
  }
  return false;
}

// Returns the first opener call in bodyClean that is NOT gated behind an
// `if (...)` (braced block OR unbraced early-return) whose condition is a
// dual-mode-tx guard on one of ownParamNames, or null if every opener call
// found is so guarded (or there are none at all).
function findUnconditionalOpener(bodyClean, ownParamNames) {
  const openers = findAllOpeners(bodyClean);
  if (openers.length === 0) return null;
  if (!ownParamNames || ownParamNames.length === 0) return openers[0];
  const blockGuards = findIfGuards(bodyClean).filter((g) => isDualModeGuardCondition(g.condText, ownParamNames));
  const earlyReturnGuards = findEarlyReturnGuards(bodyClean).filter((g) => isDualModeGuardCondition(g.condText, ownParamNames));
  for (const opener of openers) {
    const blockGuarded = blockGuards.some((g) => opener.index > g.blockStart && opener.index < g.blockEnd);
    // A braced guard can ALSO act as an early-return guard for code AFTER
    // it (see blockEndsInReturnOrThrow / the real insertBlacklist shape),
    // so its own afterIndex (when present) is checked the same way as a
    // bare early-return guard's, not just its interior.
    const earlyReturnGuarded = [...earlyReturnGuards, ...blockGuards].some(
      (g) => g.afterIndex !== undefined && opener.index > g.afterIndex,
    );
    if (!blockGuarded && !earlyReturnGuarded) return opener;
  }
  return null;
}

// ── 6. Generic call-expression discovery (bare `foo(` and `ns.foo(`) ───────
// The lookbehind means a chain like `a.b.c(` yields NO match at all (neither
// a spurious bare `c(` nor a wrong `b.c(`) rather than a wrong one — see this
// file's top doc comment on preferring false negatives over false positives.
const CALL_RE_SRC = String.raw`(?<![.\w$])([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?\s*\(`;

function findAllCalls(clean) {
  const re = new RegExp(CALL_RE_SRC, "g");
  const hits = [];
  let m;
  while ((m = re.exec(clean))) {
    hits.push({ index: m.index, ns: m[2] ? m[1] : null, name: m[2] ? m[2] : m[1] });
  }
  return hits;
}

// ── 7. Extracting an opener call's callback argument ────────────────────────
// Splits the call's argument list on top-level commas (depth-aware over
// `()[]{}` on the CLEANED text) and returns the raw text of the LAST
// argument — the callback, whether written block-bodied
// (`async (tx) => { ... }`) or concise (`(tx) => tx.select()...`.). No
// separate brace-detection is needed here: the comma-split already bounds
// the substring exactly, for either shape.
function extractCallbackText(clean, callOpenParenIdx) {
  const closeIdx = findMatchingClose(clean, callOpenParenIdx, "(", ")");
  if (closeIdx === -1) return null;
  const argsStart = callOpenParenIdx + 1;
  const args = [];
  let depth = 0, last = argsStart;
  for (let i = argsStart; i < closeIdx; i++) {
    const c = clean[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) { args.push([last, i]); last = i + 1; }
  }
  args.push([last, closeIdx]);
  const [start, end] = args[args.length - 1];
  return { start, end };
}

// ── 8. Per-file / per-service indexing ──────────────────────────────────────
function indexFile(path, source) {
  const clean = cleanSource(source);
  const defs = findFunctionDefinitions(clean);
  const functions = new Map(defs.map((d) => [d.name, d]));
  const { named, namespace } = findImports(source);
  return { path, source, clean, functions, namedImports: named, namespaceImports: namespace };
}

function resolveCall(fileIdx, ns, name, serviceIndex) {
  if (ns) {
    const nsPath = fileIdx.namespaceImports.get(ns);
    if (!nsPath) return null;
    const targetFile = resolveImportPath(fileIdx.path, nsPath, serviceIndex);
    if (!targetFile) return null;
    const targetIdx = serviceIndex.get(targetFile);
    const fn = targetIdx?.functions.get(name);
    return fn ? { file: targetFile, fn } : null;
  }
  if (fileIdx.functions.has(name)) return { file: fileIdx.path, fn: fileIdx.functions.get(name) };
  const namedImp = fileIdx.namedImports.get(name);
  if (namedImp) {
    const targetFile = resolveImportPath(fileIdx.path, namedImp.path, serviceIndex);
    if (!targetFile) return null;
    const targetIdx = serviceIndex.get(targetFile);
    const fn = targetIdx?.functions.get(namedImp.importedName);
    return fn ? { file: targetFile, fn } : null;
  }
  return null;
}

// Cycle-safe BFS: does ANY function transitively reachable from
// (file, fn) — including (file, fn) itself — directly open a transaction?
// See this file's top doc comment (§3) for why there is no fixed depth cap.
function reachesOpener(file, fn, serviceIndex) {
  const visited = new Set();
  const queue = [{ file, fn, chain: [fn.name], depth: 0 }];
  while (queue.length > 0) {
    const { file: f, fn: node, chain, depth } = queue.shift();
    const key = `${f}::${node.name}::${node.bodyStart}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const fileIdx = serviceIndex.get(f);
    const bodyClean = fileIdx.clean.slice(node.bodyStart, node.bodyEnd);
    const opener = findUnconditionalOpener(bodyClean, node.paramNames);
    if (opener) return { chain, depth, openerName: opener.name };

    for (const call of findAllCalls(bodyClean)) {
      if (isOpenerCallText(call.ns, call.name)) continue; // handled via findAllOpeners above
      const resolved = resolveCall(fileIdx, call.ns, call.name, serviceIndex);
      if (!resolved) continue;
      const k2 = `${resolved.file}::${resolved.fn.name}::${resolved.fn.bodyStart}`;
      if (!visited.has(k2)) queue.push({ file: resolved.file, fn: resolved.fn, chain: [...chain, resolved.fn.name], depth: depth + 1 });
    }
  }
  return null;
}

function lineIndexOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}
function lineAt(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// ── 9. Core analysis — exported for fixture-based unit testing. ────────────
// `files`: Array<{ path, source }>, `path` POSIX-relative to the service
// root (e.g. "src/modules/dashboard/queries.ts"), scoped to ONE service.
export function scanServiceForNestedTransactions(files) {
  const serviceIndex = new Map(files.map((f) => [f.path, indexFile(f.path, f.source)]));
  const violations = [];

  for (const fileIdx of serviceIndex.values()) {
    const lines = lineIndexOf(fileIdx.source);
    const openers = findAllOpeners(fileIdx.clean);
    for (const opener of openers) {
      const cb = extractCallbackText(fileIdx.clean, opener.callOpenParenIdx);
      if (!cb) continue;
      const cbClean = fileIdx.clean.slice(cb.start, cb.end);

      // (a) direct nesting: another opener call textually inside this one's
      //     callback (depth 0 — table stakes, but still worth its own path
      //     since it's what makes blind-spot #2 visible at all once fixed).
      for (const inner of findAllOpeners(cbClean)) {
        violations.push({
          file: fileIdx.path,
          line: lineAt(lines, cb.start + inner.index),
          outerOpener: opener.name,
          openerName: inner.name,
          chain: [],
          depth: 0,
          kind: "direct",
        });
      }

      // (b) transitive nesting: a resolvable local call whose callee (or a
      //     callee of a callee, ...) opens a transaction — blind spot #3.
      for (const call of findAllCalls(cbClean)) {
        if (isOpenerCallText(call.ns, call.name)) continue; // already counted in (a)
        const resolved = resolveCall(fileIdx, call.ns, call.name, serviceIndex);
        if (!resolved) continue;
        const found = reachesOpener(resolved.file, resolved.fn, serviceIndex);
        if (found) {
          violations.push({
            file: fileIdx.path,
            line: lineAt(lines, cb.start + call.index),
            outerOpener: opener.name,
            openerName: found.openerName,
            chain: found.chain,
            depth: found.depth,
            kind: "transitive",
          });
        }
      }
    }
  }

  violations.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return violations;
}

// ── 10. Fleet discovery + CLI ────────────────────────────────────────────────
function discoverServiceDirs() {
  if (!existsSync(SERVICES_DIR)) return [];
  return readdirSync(SERVICES_DIR)
    .filter((d) => d.endsWith("-service") && statSync(join(SERVICES_DIR, d)).isDirectory())
    .filter((d) => (only ? d === only || d === `${only}-service` : true))
    .sort();
}

function discoverServiceFiles(svcDir) {
  const svcRoot = join(SERVICES_DIR, svcDir);
  const srcDir = join(svcRoot, "src");
  if (!existsSync(srcDir)) return [];
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
        files.push(full);
      }
    }
  })(srcDir);
  // `path` is POSIX-relative to the SERVICE root (e.g.
  // "src/modules/orchestrator/repo.ts") -- this is the same shape
  // resolveImportPath()/indexFile() key everything by, so a relative import
  // like "../../shared/db.js" resolves to "src/shared/db.ts" and matches.
  const toPosix = (p) => p.split(process.platform === "win32" ? "\\" : "/").join("/");
  return files.map((abs) => ({ path: toPosix(relative(svcRoot, abs)), abs }));
}

function main() {
  const svcDirs = discoverServiceDirs();
  const allViolations = []; // { key, svc, file, line, ... }

  for (const svc of svcDirs) {
    const fileRefs = discoverServiceFiles(svc);
    const files = fileRefs.map((f) => ({ path: f.path, source: readFileSync(f.abs, "utf8") }));
    const violations = scanServiceForNestedTransactions(files);
    for (const v of violations) {
      allViolations.push({ key: `${svc}/${v.file}:${v.line}`, svc, ...v });
    }
  }

  console.log(`${BOLD}nested-tx-guard${RESET}: scanned ${svcDirs.length} service(s) fleet-wide`);

  if (WRITE_BASELINE) {
    const entries = allViolations.map((v) => v.key).sort();
    const baseline = {
      $comment:
        "TRACKED DEBT, not an approved state. Each entry is a call site inside an open tenantTransaction()/scopedRead()/db.transaction() scope that directly or transitively (via 1+ local function calls) opens ANOTHER one of those, which can deadlock the connection pool under concurrent load the same way TX-001's 84 real sites did. TX-001's own DoD claims 0 genuine sites remain fleet-wide after its sweep, so this file's expected baseline is empty; if this list is non-empty, treat every entry as a real, separate finding to review (fix it, or if it's a scanner false positive, fix the scanner) -- never as something to silently absorb into the ratchet to make CI pass. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md TX-011 and TX-001. Regenerate with --write-baseline only after confirming any newly-absent entry is a real, reviewed fix.",
      generatedAt: new Date().toISOString().slice(0, 10),
      count: entries.length,
      entries,
    };
    writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`${GREEN}Wrote ${entries.length} entries to ${relative(REPO_ROOT, BASELINE_FILE)}${RESET}`);
    process.exit(0);
  }

  let baselineEntries = new Set();
  if (existsSync(BASELINE_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
      baselineEntries = new Set(parsed.entries ?? []);
    } catch (e) {
      console.error(`${RED}Could not parse ${relative(REPO_ROOT, BASELINE_FILE)}: ${e.message}${RESET}`);
      process.exit(1);
    }
  }

  const currentKeys = new Set(allViolations.map((v) => v.key));
  const newViolations = allViolations.filter((v) => !baselineEntries.has(v.key));
  const staleEntries = only ? [] : [...baselineEntries].filter((k) => !currentKeys.has(k)).sort();
  const knownDebt = allViolations.filter((v) => baselineEntries.has(v.key));

  if (allViolations.length === 0) {
    console.log(`${GREEN}PASS${RESET} — no nested transaction/scopedRead opens found anywhere in scope.`);
  } else {
    console.log(`${allViolations.length} nested-transaction call site(s) (${knownDebt.length} tracked in baseline, ${newViolations.length} new):`);
    for (const v of allViolations) {
      const isNew = !baselineEntries.has(v.key);
      const desc = v.kind === "direct"
        ? `directly opens ${v.openerName} while inside ${v.outerOpener}`
        : `calls ${v.chain.join(" -> ")} which opens ${v.openerName}, while inside ${v.outerOpener} (depth ${v.depth})`;
      console.log(`  ${isNew ? RED : YELLOW}${v.svc}/${v.file}:${v.line}${isNew ? "  <-- NEW, not in baseline" : "  (baselined debt)"}${RESET}`);
      console.log(`      ${DIM}${desc}${RESET}`);
    }
  }

  let failed = false;
  if (newViolations.length > 0) {
    console.log(`${RED}FAIL${RESET} — ${newViolations.length} new nested-transaction call site(s). Route the nested call through a caller-supplied \`tx\` (a \`...Tx(tx, ...)\` sibling, TX-001's convention) instead of opening a second transaction/scopedRead, or if this is genuinely tracked debt being ported in, run --write-baseline.`);
    failed = true;
  }
  if (staleEntries.length > 0) {
    console.log(`${RED}FAIL${RESET} — ${staleEntries.length} baseline entr${staleEntries.length === 1 ? "y no longer reproduces" : "ies no longer reproduce"} — regenerate with --write-baseline so a real fix can't be silently reverted for free:`);
    for (const k of staleEntries) console.log(`  ${GREEN}${k}${RESET}  (no longer a violation, remove from baseline)`);
    failed = true;
  }
  if (!failed) {
    console.log(`${GREEN}PASS${RESET} — no new violations, baseline is accurate (${knownDebt.length} tracked legacy entries remain).`);
  }

  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
