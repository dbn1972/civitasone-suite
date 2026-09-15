#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// raw-session-guc-guard.mjs — PgBouncer transaction-pool session-leak guard
// (PERF-001 fix-up)
//
// PERF-001 routes the whole fleet through PgBouncer with `pool_mode =
// transaction`. Under transaction pooling a backend server connection is
// handed to a DIFFERENT client the instant the current transaction ends, and
// (see infra/pgbouncer/pgbouncer.ini) PgBouncer only guarantees a full
// `server_reset_query` between handoffs when `server_reset_query_always = 1`
// is also set. Any code that sets a session-scoped Postgres GUC — a raw
// `SET app.tenant_id = ...` (not `SET LOCAL`), or `set_config('app.foo', v,
// false)` (`is_local=false`) — leaves that value sitting on the shared
// backend connection for whichever unrelated client the pool hands it to
// next. For a tenant-scoping GUC this is a cross-tenant data leak; live-
// reproduced against an isolated PgBouncer built from this repo's exact
// pooling config (raw `SET app.tenant_id` on one client, visible from 5
// separate subsequent client connections through the pool).
//
// Two production migrations (services/finance-service/migrations/0070_*.sql,
// services/notification-service/migrations/0044_*.sql) shipped exactly this
// pattern; this guard exists so a third one can't.
//
// COMPLIANT: `SET LOCAL app.foo = ...` / `set_config('app.foo', v, true)`
//            (transaction-scoped — cleared automatically at commit/rollback,
//            same guarantee `server_reset_query_always` gives PgBouncer;
//            packages/db/src/raw-tenant-guc.ts's `withRawTenantGuc` and
//            services/audit-service/migrations/0025_*.sql are the
//            established patterns).
// VIOLATION: `SET app.foo = ...` / `SET app.foo TO ...` / `SET SESSION
//            app.foo = ...` (session-scoped). `TO` is Postgres's own
//            accepted synonym for `=` in a SET statement, but it is ALSO
//            the ordinary English word "to" — matching it unconditionally
//            false-positives on application log/error strings. An earlier
//            fix-up gated `TO` on the guard's isSql (file-extension) flag,
//            which fixed that false positive but introduced a regression:
//            it silently stopped catching `TO`-syntax raw SQL embedded in
//            a `.ts`/`.mjs` file via a template literal (e.g. handed to
//            `sql.unsafe(...)`). Fixed by requiring a quoted/interpolated
//            value-like token immediately after `TO` instead of gating on
//            file extension. A BARE, unquoted value after `TO` (`TO
//            DEFAULT` / `TO 5` / `TO my_var`, with or without a trailing
//            terminator) is NOT caught, in any form — a permanently
//            accepted gap; 4 review rounds found no regex heuristic that
//            catches it without also flagging ordinary English sentences
//            naming these same tenant-scoped identifiers — see RAW_SET_RE
//            below for the full history /
//            `set_config('app.foo', v, false)` /
//            `set_config('app.foo', v, <anything other than a literal
//            true>)` — a non-literal third argument (a variable, a function
//            call, ...) can't be proven transaction-scoped by static
//            inspection, so it is treated the same as an explicit `false`
//            (PERF-013). Detection also tolerates the statement's keyword,
//            GUC name and operator being split across lines, or assembled
//            via `+` string concatenation — see SET_TRIGGER_RE and
//            collapseConcatJoins() below (also PERF-013; both were
//            independently confirmed false negatives of the original,
//            strictly-single-line, contiguous-text-only match).
//
// A RELATED BUT SEPARATE check flags non-transaction-scoped advisory locks
// (`pg_advisory_lock`/`pg_try_advisory_lock`/`..._shared`, as opposed to the
// `..._xact_...` variants) fleet-wide. Same underlying risk shape (session
// state that outlives one transaction, silently inherited by the pool's next
// client) even though the specific mechanism (advisory lock, not a tenant
// GUC) is lower severity — a stuck/leaked lock, not a cross-tenant data leak.
//
// Scans every `.sql` file under `services/*/migrations/`, and every
// `.ts`/`.mjs` file under `services/*/src/` / `packages/*/src/` — the paths
// that actually run against the pooled connection in production. See
// `discoverFiles()` below for why `tests/`/`integration/`/`scripts/seed/`
// are deliberately out of scope for enforcement (a real, tracked, lower-
// priority finding, not an oversight).
//
// Best-effort comment stripping (SQL `--`/`/* */`, JS/TS `//`/`/* */`) before
// matching, string literals not perfectly respected — conservative in the
// same direction as scripts/ci/tenant-router-guard.mjs (risk is under-, not
// over-, reporting inside a string literal, never the reverse).
//
// Usage:  node scripts/ci/raw-session-guc-guard.mjs      (from repo root)
// Exit:   0 when clean, 1 when any violation is found (either check).
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ci/raw-session-guc-guard.mjs  ->  repo root is two levels up.
const REPO_ROOT = join(__dirname, "..", "..");

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "build", ".git", "coverage", ".turbo"]);
const SCAN_EXTS = new Set([".sql", ".ts", ".mjs"]);

// ── 1. Discover files ───────────────────────────────────────────────────────
// Scoped to PRODUCTION code paths only: `services/*/migrations/**` (runs via
// the migration runner, and via any deploy/hotfix tooling against the real
// pooled connection) and `services/*/src/**` / `packages/*/src/**` (what
// actually serves live traffic through PgBouncer). Deliberately EXCLUDES
// `tests/`, `integration/`, and `scripts/seed/` — a first broad pass of this
// guard (scanning all of services/ + packages/) also found 33 pre-existing
// `set_config(..., false)` call sites across analytics-service,
// court-service, hrms-service (4 files beyond the one fixed alongside this
// guard), location-service, project-service and telephony-service, all in
// test/integration/seed-script code. Every one of those only ever runs
// against the direct Postgres port (5435) by the same operational
// convention noted for services/hrms-service/tests/fixtures/core-seed.ts
// (not through PgBouncer) — real, but a materially different risk profile
// from a production migration or src/ code path, and a 6-service, 33-site
// cleanup is out of scope for this fix-up round. Tracked as a fast-follow;
// see the PR description. This guard enforces the migrations/src/ subset
// strictly (zero violations, unconditionally) so that class of bug can
// never recur in the paths that actually serve pooled production traffic.
function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      if (SCAN_EXTS.has(extname(entry.name))) out.push(join(dir, entry.name));
    }
  }
}

function discoverFiles() {
  const files = [];

  const servicesDir = join(REPO_ROOT, "services");
  if (existsSync(servicesDir) && statSync(servicesDir).isDirectory()) {
    for (const svc of readdirSync(servicesDir)) {
      const svcDir = join(servicesDir, svc);
      if (!statSync(svcDir).isDirectory()) continue;
      const migrationsDir = join(svcDir, "migrations");
      if (existsSync(migrationsDir) && statSync(migrationsDir).isDirectory()) walk(migrationsDir, files);
      const srcDir = join(svcDir, "src");
      if (existsSync(srcDir) && statSync(srcDir).isDirectory()) walk(srcDir, files);
    }
  }

  const packagesDir = join(REPO_ROOT, "packages");
  if (existsSync(packagesDir) && statSync(packagesDir).isDirectory()) {
    for (const pkg of readdirSync(packagesDir)) {
      const srcDir = join(packagesDir, pkg, "src");
      if (existsSync(srcDir) && statSync(srcDir).isDirectory()) walk(srcDir, files);
    }
  }

  return files.sort();
}

// ── 2. Comment stripping (best-effort) ──────────────────────────────────────
// `sqlStyle=true` treats `--` as a line comment (SQL); otherwise `//` (JS/TS).
// Both styles share `/* ... */` block comments. Line count is preserved so
// reported line numbers stay accurate.
function stripComments(source, sqlStyle) {
  const lineCommentToken = sqlStyle ? "--" : "//";
  const out = [];
  let inBlock = false;
  for (const rawLine of source.split("\n")) {
    let line = rawLine;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      line = " ".repeat(end + 2) + line.slice(end + 2);
      inBlock = false;
    }
    let result = "";
    let i = 0;
    while (i < line.length) {
      const two = line.slice(i, i + 2);
      if (two === "/*") {
        const end = line.indexOf("*/", i + 2);
        if (end === -1) {
          inBlock = true;
          break;
        }
        result += " ".repeat(end + 2 - i);
        i = end + 2;
      } else if (two === lineCommentToken) {
        break;
      } else {
        result += line[i];
        i += 1;
      }
    }
    out.push(result);
  }
  return out;
}

// ── 3. Check 1: raw session-scoped tenant/app GUC ───────────────────────────
// Matches `SET app.foo = ...` / `SET app.foo TO ...` / `SET SESSION app.foo
// = ...` but NOT `SET LOCAL app.foo = ...`. `(?!LOCAL\b)` after `SET\s+`
// rejects LOCAL right after SET; `SESSION` is accepted (still a violation —
// session-scoped). `TO` is Postgres's own accepted synonym for `=` in a SET
// statement (PERF-013 — the pre-fix version only recognized `=`).
//
// Bare `TO` is ALSO just the ordinary English word "to", so matching it
// unconditionally is a false-positive generator — live-reproduced on a line
// that is not SQL at all: `throw new Error("SET app.tenant_id to a valid
// UUID before calling this")` (PERF-013 review follow-up, issue A). The
// first attempt at closing that false positive gated the `TO` alternative
// on the guard's isSql flag (computed once per file from its extension, in
// main()), via a separate RAW_SET_RE_SQL pattern applied only to `.sql`
// files. That fixed the false positive but is too broad a hammer: it also
// silently stopped matching real raw SQL using `TO` syntax that's embedded
// in a `.ts`/`.mjs` file via a template literal handed to something like
// `sql.unsafe(...)` — e.g. `await sql.unsafe(\`SET app.tenant_id TO
// '${T}'\`)` — a genuine regression, independently found in a second
// review pass (0 violations against the isSql-gated version; 1 against the
// version before that gate was added, proving it a real regression and not
// a pre-existing gap).
//
// Fixed (round 3) by tightening what `TO` may be followed by instead of
// gating on file extension: `\bTO\s*(?=['"$:])` only matches when the next
// non-space character looks like the start of a QUOTED/interpolated value —
// a quote (a SQL string literal), `$` (a `${...}` template interpolation or
// a `$1` bound parameter), or `:` (a `:'name'`/`:name` bind/psql-variable
// form). Plain English "to" in a sentence is essentially never immediately
// followed by one of those three characters, so this resolved the false
// positive without depending on isSql/file extension at all — covering both
// real `.sql` files and the embedded-in-`.ts`-via-template-literal case
// above with one pattern, no isSql dispatch needed.
//
// Round 3 shipped with a real residual gap of its own (found in review
// round 4): a BARE, unquoted value after TO — `SET app.tenant_id TO
// DEFAULT;` / `TO 5;` / `TO my_tenant_var;` (the last of which is ordinary,
// realistic PL/pgSQL — a variable/parameter reference, exactly the class of
// raw session-scoped SET this guard exists to catch) — starts with none of
// `'"$:`, so round 3's lookahead silently missed all three. Confirmed as a
// genuine regression, not a pre-existing gap: all three correctly triggered
// a violation against bb64f216's parent (before round 3's fix landed). 0
// live occurrences in the fleet either way (latent gap, not an active leak).
//
// Round 4 tried to close this by ADDING a second, independent value-start
// signal alongside round 3's quote/$/colon lookahead (not replacing it): a
// bareword (identifier/keyword/integer) would count as a value start when
// immediately followed, after only inline whitespace, by a statement
// terminator (`;`, a newline, or end of the scanned text) — the reasoning
// being that a real `SET x TO <bareword>` is always closed by exactly one
// of those in valid SQL, while ordinary English "to <word>" continues with
// more prose instead.
//
// A further, independent review (round 5 — THIS round) found round 4's
// premise unsound: a terminator immediately after a bareword is NOT
// reliably SQL-only. It is also exactly what ends the enclosing JS
// statement/string in ordinary application prose that happens to name
// `app.tenant_id`/`tenant.*` and use the word "to" before a short word —
// i.e. the SAME false-positive SHAPE round 2/round 3 already fixed once,
// reopened through a different trigger. Adversarially confirmed, e.g.:
// `throw new Error("Remember to set app.tenant_id to null; retry after
// fixing config");` — "to null" is a bareword ("null") immediately followed
// by ";", but that ";" terminates the JS `throw` statement's own string
// argument, not a SQL statement — round 4's lookahead couldn't tell the
// difference and wrongly flagged it (and multi-line/concatenated variants
// of the same shape — see the regression tests in
// raw-session-guc-guard.test.ts). Not a contrived case: log/error messages
// naming this guard's own subject-matter identifiers are exactly the
// vocabulary this codebase's developers use when writing about the guard
// itself — the same observation that motivated round 2's original fix.
//
// DECISION (round 5): round 4's addition is REVERTED. RAW_SET_RE below is
// back to round 3's `\bTO\s*(?=['"$:])` — quoted/interpolated values only —
// with no known false-positive class of its own. This trades away round
// 4's partial bareword-detection improvement in exchange for closing a
// confirmed, adversarially-demonstrated false-positive regression.
//
// The FULL bareword-TO gap is therefore ONE unified, DELIBERATELY ACCEPTED
// limitation — not fixed here, and not expected to be fixable by a better
// regex: this guard does not catch `SET x TO <value>` in ANY bareword form
// (a keyword like DEFAULT, a number, or a bare identifier — with or
// without a trailing terminator, on one line or split across lines) unless
// the value is quoted, `${...}`-interpolated, or `:`-bind-prefixed. Four
// review rounds (2 through 5) tried progressively narrower regex
// heuristics to close this without reopening the English-prose false
// positive, and none succeeded: every heuristic tried either missed real
// bareword `SET ... TO` statements or flagged real English sentences
// naming the same `app.*`/`tenant.*` identifiers. Actually closing it would
// need real SQL/tagged-template parsing (an AST walk, not a regex), out of
// proportion for a P2 gap with 0 live occurrences in the fleet today.
// Documented here rather than silently left as a surprise — same
// convention discoverFiles() above uses for its own out-of-scope
// set_config sites — and exercised by the "[KNOWN GAP, accepted]" tests in
// raw-session-guc-guard.test.ts (representative bareword shapes, with and
// without a terminator, single- and multi-line).
const RAW_SET_RE =
  /\bSET\s+(?!LOCAL\b)(?:SESSION\s+)?((?:app|tenant)\.[A-Za-z_][A-Za-z0-9_]*)\s*(?:=|\bTO\s*(?=['"$:]))/gi;

// A candidate line is any line containing the bare `SET` keyword; the actual
// identifier/operator is then searched for across a short forward window —
// this line plus a few more — rather than only this one line. PERF-013 found
// two real gaps this closes: a formatter (or a query assembled a piece at a
// time) can put `SET` on its own line with the GUC name and `=`/`TO` a line
// or two later, and — separately — LOCAL, wherever it falls in that gap,
// still blocks a match (the identifier group can only ever align with
// "app."/"tenant.", never with "LOCAL", so the exclusion holds across the
// window exactly as it did on one line). Same short-lookahead-window
// technique scripts/ci/flaky-skip-guard.mjs already uses to find a skip
// call's title/second argument a line or two after its trigger token.
const SET_TRIGGER_RE = /\bSET\b/i;
const SET_LOOKAHEAD_LINES = 4;

// PERF-013's other confirmed false negative for the raw SET check: a
// statement assembled via string concatenation, e.g.
// `"SET app.tenant_id" + " = '" + tenantId + "'"`. In the raw source text
// this reads as two strings glued by `+` — the characters actually sitting
// between "app.tenant_id" and "=" are a closing quote, `+`, and an opening
// quote, none of which is whitespace, so RAW_SET_RE never lines up. This
// collapses a `<quote> + <quote>`-shaped join (either quote style, any of
// `'`/`"`/`` ` ``, whitespace or newlines around the `+`) between two
// adjacent literal fragments so a statement built that way reads as one
// contiguous run before RAW_SET_RE is applied — the same "normalize the
// text before matching" idea stripComments() above already uses, aimed at a
// different kind of noise between the tokens that matter here. SQL uses
// `||`, never `+`, for string building, so this is only meaningful (and
// only applied) for JS/TS source.
//
// The replacement preserves however many newlines the matched join span
// itself contained (zero, for the common same-line case) instead of always
// collapsing to the empty string. checkTenantGucViolations() below locates
// a match's line by counting newlines in this collapsed text, so silently
// deleting a *real* physical newline here (a join whose `+` sits on its
// own line, or between two lines) desyncs that count from the original
// `lines` array — independently found in review to produce a phantom extra
// violation: a multi-line concatenation of ordinary, non-violating text
// that happens to also contain the bare word "SET" (triggering the window
// check) immediately followed, within the same lookahead window, by a real
// violation, could report that real violation TWICE — once misattributed
// to the wrong (earlier) line under the desynced count, and once more,
// correctly, when the outer loop separately reaches the real violation's
// own line. Keeping the newline count intact avoids the desync; `\s*`/
// `\s+` in the matching regexes are indifferent to a run of newlines vs.
// nothing at this position, so this changes nothing about whether or what
// matches — only where a match is reported.
const CONCAT_JOIN_RE = /(['"`])\s*\+\s*(['"`])/g;
function collapseConcatJoins(text) {
  return text.replace(CONCAT_JOIN_RE, (m) => "\n".repeat((m.match(/\n/g) || []).length));
}

// Matches `set_config('app.foo', <value>, <is_local>)` and captures the
// is_local argument as-is, not just literal `true`/`false`. PERF-013 found
// that a call whose third argument is a variable or other expression (e.g.
// `set_config('app.tenant_id', v, isLocalFlag)`) didn't match the old
// `(true|false)`-only pattern AT ALL, so it was silently ignored regardless
// of what that argument actually holds at runtime. Only a literal `true` is
// treated as proven-safe below; an explicit `false` or any non-literal third
// argument this guard has no way to evaluate statically is now flagged. The
// middle (value) argument is still matched as "anything but a paren" so the
// match can't stretch past this call's own closing `)` into a LATER,
// unrelated set_config(...) call further down the file — every real value
// argument in this codebase (a UUID string literal, a `${...}` template
// interpolation, a `:'bind_param'`, a bound `$1`) satisfies that; a value
// that itself calls a function would not match, which is fine — this guard
// is best-effort and errs toward under- rather than over-reporting for that
// argument specifically.
const SET_CONFIG_RE = /\bset_config\s*\(\s*['"]((?:app|tenant)\.[A-Za-z_][A-Za-z0-9_]*)['"]\s*,\s*[^()]*?,\s*([^()]*?)\s*\)/gi;

export function checkTenantGucViolations(source, isSql) {
  const lines = stripComments(source, isSql);
  const violations = [];

  let i = 0;
  while (i < lines.length) {
    if (!SET_TRIGGER_RE.test(lines[i])) {
      i += 1;
      continue;
    }
    const windowEnd = Math.min(i + SET_LOOKAHEAD_LINES, lines.length);
    const rawWindow = lines.slice(i, windowEnd).join("\n");
    const windowText = isSql ? rawWindow : collapseConcatJoins(rawWindow);
    // One pattern covers both contexts now — TO is gated on what follows
    // it (see RAW_SET_RE above), not on isSql/file extension.
    RAW_SET_RE.lastIndex = 0;
    const m = RAW_SET_RE.exec(windowText);
    if (!m) {
      i += 1;
      continue;
    }
    // The trigger line (i) is just wherever the bare `SET` keyword was
    // found — the actual pattern match can start on a LATER line within the
    // window (e.g. a harmless `SET statement_timeout = ...;` trigger line
    // immediately followed by the real `SET app.tenant_id = ...;`
    // violation). Count newlines in windowText BEFORE the match start to
    // find which line within the window it actually starts on, rather than
    // hardcoding the window's start line — a line/snippet misattribution
    // bug independently found in review (the count/pass-fail outcome was
    // never wrong, only the reported location).
    const matchLineOffset = windowText.slice(0, m.index).split("\n").length - 1;
    const matchLine = i + matchLineOffset;
    const consumedLines = (m[0].match(/\n/g) || []).length;
    violations.push({
      line: matchLine + 1,
      snippet: consumedLines > 0 ? m[0].replace(/\s+/g, " ").trim() : lines[matchLine].trim(),
      reason: `raw session-scoped SET (${m[1]}) — use SET LOCAL, or set_config('${m[1]}', ..., true) inside a transaction`,
    });
    // Advance past whatever lines the match itself spanned (from wherever it
    // actually started, not from the trigger line) so the tail of this same
    // statement can't be re-triggered as a new candidate. The common case —
    // a single-line match starting right on the trigger line — has
    // matchLineOffset 0 and consumedLines 0, and just falls through to
    // i += 1, unchanged from the pre-PERF-013 behavior.
    i = matchLine + consumedLines + 1;
  }

  // set_config(...) can legitimately span multiple lines, so check against
  // the whole stripped source (not line-by-line) and locate the reported
  // line by the match's start offset.
  const stripped = lines.join("\n");
  SET_CONFIG_RE.lastIndex = 0;
  let sm;
  while ((sm = SET_CONFIG_RE.exec(stripped)) !== null) {
    const thirdArg = sm[2].trim();
    if (/^true$/i.test(thirdArg)) continue; // literal true — proven transaction-scoped, the safe pattern
    const upToMatch = stripped.slice(0, sm.index);
    const lineNo = upToMatch.split("\n").length;
    const isLiteralFalse = /^false$/i.test(thirdArg);
    violations.push({
      line: lineNo,
      snippet: lines[lineNo - 1]?.trim() ?? sm[0].trim(),
      reason: isLiteralFalse
        ? `set_config('${sm[1]}', ..., false) is session-scoped — pass true (SET LOCAL semantics) instead`
        : `set_config('${sm[1]}', ..., ${thirdArg || "<empty>"}) — is_local isn't a literal \`true\`, so this can't be statically proven transaction-scoped; pass a literal true, or restructure to SET LOCAL, inside a transaction`,
    });
  }

  violations.sort((a, b) => a.line - b.line);
  return violations;
}

// ── 4. Check 2 (related, separate): non-xact advisory locks ────────────────
// Flags pg_advisory_lock / pg_try_advisory_lock / their _shared variants —
// but not the _xact_ (transaction-scoped) family, and not the _unlock_
// family (releasing is not the risky half).
const ADVISORY_LOCK_RE = /\bpg_(try_)?advisory_lock(_shared)?\s*\(/gi;

export function checkAdvisoryLockViolations(source, isSql) {
  const lines = stripComments(source, isSql);
  const violations = [];
  lines.forEach((line, idx) => {
    ADVISORY_LOCK_RE.lastIndex = 0;
    if (ADVISORY_LOCK_RE.test(line)) {
      violations.push({
        line: idx + 1,
        snippet: line.trim(),
        reason: "session-scoped advisory lock — prefer pg_advisory_xact_lock (auto-released at commit/rollback) unless session-scoping is genuinely required and justified in a comment",
      });
    }
  });
  return violations;
}

// ── 5. Run ───────────────────────────────────────────────────────────────────
function main() {
  const files = discoverFiles();
  const gucViolations = [];
  const lockViolations = [];

  for (const file of files) {
    const isSql = extname(file) === ".sql";
    const source = readFileSync(file, "utf8");
    for (const v of checkTenantGucViolations(source, isSql)) {
      gucViolations.push({ file, ...v });
    }
    for (const v of checkAdvisoryLockViolations(source, isSql)) {
      lockViolations.push({ file, ...v });
    }
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Raw Session GUC Guard — PgBouncer transaction-pool leak (PERF-001)");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Files scanned (services/*/migrations, services/*/src, packages/*/src): ${files.length}`);
  console.log("");

  let exitCode = 0;

  if (gucViolations.length === 0) {
    console.log("  ✅ CLEAN — no raw session-scoped app.*/tenant.* GUC found.");
  } else {
    exitCode = 1;
    console.log(`  ❌ ${gucViolations.length} tenant/app GUC violation(s):`);
    console.log("");
    for (const v of gucViolations) {
      const rel = relative(REPO_ROOT, v.file).split(sep).join("/");
      console.log(`  [RAW-SESSION-GUC] ${rel}:${v.line}`);
      console.log(`      ${v.reason}`);
      console.log(`      ${v.snippet}`);
    }
  }
  console.log("");

  if (lockViolations.length === 0) {
    console.log("  ✅ CLEAN — no session-scoped (non-xact) advisory lock found.");
  } else {
    exitCode = 1;
    console.log(`  ❌ ${lockViolations.length} advisory-lock violation(s):`);
    console.log("");
    for (const v of lockViolations) {
      const rel = relative(REPO_ROOT, v.file).split(sep).join("/");
      console.log(`  [SESSION-ADVISORY-LOCK] ${rel}:${v.line}`);
      console.log(`      ${v.reason}`);
      console.log(`      ${v.snippet}`);
    }
  }
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(exitCode);
}

// Only run when executed directly (not when imported by callers/tests) —
// mirrors scripts/ci/tenant-router-guard.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
