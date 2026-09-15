#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// authz-tenant-scanner.mjs — SEC-014: the authz-within-tenant scanner, made a
// durable tool.
//
// THE GAP THIS CLOSES
// --------------------
// Tenant isolation (tenant-table-rls-guard.mjs, tenant-predicate-guard.mjs,
// tenant-router-guard.mjs) answers "can tenant A see tenant B's data" (no). It
// does not answer "can any authenticated user of tenant A do anything any
// other user of tenant A can do" -- that is a *role/permission* question,
// answered by a completely different, much less consistently-enforced layer
// (.claude/skills/19-security-beyond-tenancy.md S1). This scanner is that
// layer's guard, not another tenant-isolation check.
//
// docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's SEC-014 row is explicit that the
// only prior version of this check was "Manual 2,110-handler scan (this
// audit)" -- an ad hoc, one-time, not-checked-in pass. This script is the
// durable replacement: it scans the real fleet on every CI run instead of
// only when someone remembers to do it by hand again.
//
// THE CHECK
// ---------
// For every mutating route (`app.post`/`app.put`/`app.patch`/`app.delete` --
// GET is deliberately out of scope, same as skill 19's own rule) registered
// under services/*/src, does the handler ITSELF (not a sibling handler in the
// same file, not the route-registration wrapper) call at least one
// recognized authorization helper before its body ends?
//
// RECOGNIZED HELPERS -- DERIVED FROM THE FLEET, NOT FROM THE DOC ALONE
// ---------------------------------------------------------------------
// Skill 19 S1 names exactly four: `requireRole`, `requireSuperAdmin`,
// `assertOwnership`, `requirePermissionKey` -- and warns in the same
// paragraph that "a review or scanner that only greps for one of these names
// will produce false negatives on the others". Taking that warning
// seriously, this scanner's allowlist was built by grepping every
// `services/*/src/shared/context.ts` and `packages/auth/src/*.ts` for every
// exported `require*`/`assert*`/`check*`/`is*`-shaped authorization function
// fleet-wide, not by copying the doc's four names verbatim -- the doc itself
// undercounts what's really out there (e.g. it predates SEC-016's
// `requireInternalOrRoles`, and never mentions payroll-service's
// `enforceEmployeeOwnership`/`isSelfServiceEmployee`, citizen-service's
// `isOfficer`, or packages/auth's own `assertGatewayRequest` /
// `assertInternalServiceSecret`). See AUTHZ_HELPER_NAMES below for the full,
// currently-known list and add to it the same way if the fleet grows a new
// name -- do not silently let this list go stale the way the doc's did.
//
// THE `config: { public: true }` ESCAPE HATCH
// ---------------------------------------------
// A real, fleet-established Fastify convention: `app.post(path, { config: {
// public: true } }, handler)` marks a route as intentionally open (e.g.
// court-service/hrms-service careers portal, telephony webhook receivers,
// visitor-service device heartbeat -- see those services' routes.ts files).
// This scanner recognizes that options-object marker and does not flag such
// routes at all, matching the fleet's own stated intent instead of guessing.
//
// KNOWN, ACCEPTED LIMITATIONS (same spirit as TX-011/nested-tx-guard.mjs and
// tenant-table-rls-guard.mjs's own documented limitations; the gap report's
// own SEC-014 row says "Scanner limits are recorded in TX-011 and SEC-014" --
// this is that acknowledgement made concrete):
//   - This checks for the PRESENCE of a recognized helper call in the handler
//     body, never whether the roles/permission passed to it are the RIGHT
//     ones for that route, nor whether a `preHandler:` array (e.g.
//     visitor-service's `deviceAuth`) provides an equally-real gate this
//     scanner does not (and should not, without a curated, verified allowlist
//     of trusted preHandler names) try to recognize by name.
//   - A route gated only by "the caller is authenticated at all, acting on
//     their own record" (e.g. reset-my-own-password, register-my-own-device)
//     has no role/permission decision to find and will read as a violation.
//     This is why new entries are triaged by a human before being accepted
//     into the baseline, not auto-approved.
//   - Best-effort text analysis: comments are stripped, but string/template
//     literals are not specially parsed, so a stray unbalanced brace inside a
//     string literal could misalign the handler-body scan for that one call
//     (same accepted trade-off as arch-guard.mjs's stripComments).
//
// RATCHET, NOT A RETROACTIVE GATE (identical mechanic to tenant-table-rls-
// guard.mjs / tenant-index-guard.mjs / empty-vs-error-guard.mjs): the fleet's
// real, current shape is grandfathered into a baseline once, and the gate is
// only on NEW violations (a handler added after this guard existed with no
// recognized helper call) and STALE baseline entries (a listed handler that
// no longer reproduces -- regenerate, don't hand-edit).
//
// Usage:
//   node scripts/ci/authz-tenant-scanner.mjs                  # guard: exit 1 on
//                                                               # new/stale baseline entries
//   node scripts/ci/authz-tenant-scanner.mjs --write-baseline  # regenerate the baseline
//                                                               # from the current tree
//
// No live database or build needed -- pure source-text analysis, so this runs
// in the arch-guard job like the other text-analysis guards above it.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");
const BASELINE_FILE = join(__dirname, "authz-tenant-scanner-baseline.json");

const WRITE_BASELINE = process.argv.includes("--write-baseline");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// ── Recognized authorization helpers (see header comment for provenance) ───
export const AUTHZ_HELPER_NAMES = [
  "requireRole",
  "requireSuperAdmin",
  "assertOwnership",
  "requirePermissionKey",
  "requirePermission",
  "requireInternalOrRoles",
  "checkPermission",
  "assertGatewayRequest",
  "assertInternalServiceSecret",
  "enforceEmployeeOwnership",
  "isSelfServiceEmployee",
  "isOfficer",
];
const AUTHZ_HELPER_RE = new RegExp(`\\b(?:${AUTHZ_HELPER_NAMES.join("|")})\\s*\\(`);

const MUTATING_METHODS = ["post", "put", "patch", "delete"];

// ── Comment stripping (best-effort, mirrors arch-guard.mjs exactly: strings
//    are not specially respected, which keeps this conservative -- the risk
//    is under- not over-reporting a genuine `//`/`/* */` inside a string). ──
function stripComments(source) {
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
      } else if (two === "//") {
        break;
      } else {
        result += line[i];
        i += 1;
      }
    }
    out.push(result);
  }
  return out.join("\n");
}

// ── Balanced-bracket walk: given `text` and an index at an opening bracket,
//    return the index of its matching close, or -1. Shared by the options-
//    object skip and the handler-body extraction below. Not string-aware
//    (see header comment's accepted limitations). ──────────────────────────
function findMatchingBracket(text, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const APP_CALL_RE = /\bapp\.(post|put|patch|delete)\s*\(/g;
const PATH_STRING_RE = /^\s*(["'`])([^"'`]*)\1/;
const COMMA_RE = /^\s*,\s*/;
// Every mutating-handler signature seen fleet-wide is one of: `async (req,
// reply)`, `(req, reply)`, or `async (req: FastifyRequest, reply:
// FastifyReply)` -- none nest parens in the arg list, so a plain `[^)]*` is
// sufficient (unlike tenant-table-rls-guard's column-list walk, which does
// need real paren-depth tracking for `varchar(64)`/`CHECK(...)`).
const HANDLER_START_RE = /^\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{/;
const PUBLIC_MARKER_RE = /\bpublic\s*:\s*true\b/;

// ── Core scan, exported for unit testing (see
//    tests/architecture/authz-tenant-scanner.test.ts). Pure: operates on one
//    file's source text and returns violations with no file-path knowledge,
//    mirroring findTenantTableViolations()'s shape in
//    tenant-table-rls-guard.mjs. ────────────────────────────────────────────
export function findAuthzViolations(sourceText) {
  const text = stripComments(sourceText);
  const violations = [];

  APP_CALL_RE.lastIndex = 0;
  let m;
  while ((m = APP_CALL_RE.exec(text)) !== null) {
    const method = m[1].toUpperCase();
    let pos = m.index + m[0].length;

    const pathMatch = PATH_STRING_RE.exec(text.slice(pos));
    if (!pathMatch) continue; // unparseable shape -- skip, don't guess
    const routePath = pathMatch[2];
    pos += pathMatch[0].length;

    const comma1 = COMMA_RE.exec(text.slice(pos));
    if (!comma1) continue;
    pos += comma1[0].length;

    let optionsText = "";
    if (text[pos] === "{") {
      const closeIdx = findMatchingBracket(text, pos, "{", "}");
      if (closeIdx === -1) continue;
      optionsText = text.slice(pos, closeIdx + 1);
      pos = closeIdx + 1;
      const comma2 = COMMA_RE.exec(text.slice(pos));
      if (!comma2) continue;
      pos += comma2[0].length;
    }

    const handlerMatch = HANDLER_START_RE.exec(text.slice(pos));
    if (!handlerMatch) continue; // unparseable shape -- skip, don't guess
    const bodyOpenIdx = pos + handlerMatch[0].length - 1;
    const bodyCloseIdx = findMatchingBracket(text, bodyOpenIdx, "{", "}");
    if (bodyCloseIdx === -1) continue;
    const bodyText = text.slice(bodyOpenIdx, bodyCloseIdx + 1);

    if (PUBLIC_MARKER_RE.test(optionsText)) continue; // fleet's own public-route escape hatch
    if (AUTHZ_HELPER_RE.test(bodyText)) continue; // a recognized helper is called somewhere in this handler

    const lineNo = text.slice(0, m.index).split("\n").length;
    violations.push({ method, path: routePath, line: lineNo });
  }

  return violations;
}

// ── File discovery: services/<svc>/src/**/*.ts, skipping the same dirs/file
//    suffixes as arch-guard.mjs. ─────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".turbo", "coverage"]);
function isSkippedFile(name) {
  return name.endsWith(".test.ts") || name.endsWith(".spec.ts") || name.endsWith(".d.ts");
}
function* walkTsFiles(dir) {
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
      yield* walkTsFiles(full);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !isSkippedFile(entry.name)) {
      yield full;
    }
  }
}
function discoverServiceSrcDirs() {
  if (!existsSync(SERVICES_DIR)) return [];
  return readdirSync(SERVICES_DIR)
    .map((d) => join(SERVICES_DIR, d, "src"))
    .filter((d) => existsSync(d) && statSync(d).isDirectory());
}

// ── Run ──────────────────────────────────────────────────────────────────────
function main() {
  const allViolations = []; // { key, file, method, path, line }
  let filesScanned = 0;
  let handlersScanned = 0;

  for (const srcDir of discoverServiceSrcDirs()) {
    for (const file of walkTsFiles(srcDir)) {
      filesScanned += 1;
      const source = readFileSync(file, "utf8");
      const rel = relative(REPO_ROOT, file).split(sep).join("/");
      const found = findAuthzViolations(source);
      handlersScanned += (source.match(APP_CALL_RE) ?? []).length;
      for (const v of found) {
        allViolations.push({ key: `${rel}::${v.method} ${v.path}`, file: rel, ...v });
      }
    }
  }

  console.log(
    `${BOLD}authz-tenant-scanner${RESET}: scanned ${filesScanned} source file(s), ${handlersScanned} mutating route registration(s) fleet-wide`,
  );

  if (WRITE_BASELINE) {
    const entries = allViolations.map((v) => v.key).sort();
    const baseline = {
      $comment:
        "TRACKED DEBT, not an approved state (SEC-014). Each entry is a mutating (POST/PUT/PATCH/DELETE) route handler in which this scanner found no call to a recognized authorization helper (see AUTHZ_HELPER_NAMES in authz-tenant-scanner.mjs) and no `config: { public: true }` marker. Some entries are genuine missing-authz gaps (the fleet's own manual 2,110-handler audit found real ones, e.g. historically services/hrms-service/src/modules/social/routes.ts's announcements handler until it was fixed); others are known scanner limitations, not real bugs -- a preHandler-gated route (e.g. visitor-service's deviceAuth), or a self-service-by-session action with no role/permission decision to find. The gate is on NEW entries (a handler added after this guard existed) and STALE entries (a listed handler that no longer reproduces -- confirm it's a real, reviewed fix before regenerating, not an accidental deletion/rename). See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md SEC-014 and .claude/skills/19-security-beyond-tenancy.md S1. Regenerate with --write-baseline only after confirming any newly-absent entries are a real, reviewed fix.",
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
  const staleEntries = [...baselineEntries].filter((k) => !currentKeys.has(k)).sort();
  const knownDebt = allViolations.filter((v) => baselineEntries.has(v.key));

  if (allViolations.length === 0) {
    console.log(`${GREEN}PASS${RESET} -- every mutating handler calls a recognized authorization helper (or is marked public).`);
  } else {
    console.log(
      `${allViolations.length} mutating handler(s) with no recognized authorization helper call (${knownDebt.length} tracked in baseline, ${newViolations.length} new):`,
    );
    for (const v of allViolations) {
      const isNew = !baselineEntries.has(v.key);
      console.log(
        `  ${isNew ? RED : YELLOW}${v.file}:${v.line} -- ${v.method} ${v.path}${isNew ? "  <-- NEW, not in baseline" : "  (baselined debt)"}${RESET}`,
      );
    }
  }

  let failed = false;
  if (newViolations.length > 0) {
    console.log(
      `${RED}FAIL${RESET} -- ${newViolations.length} new mutating handler(s) with no recognized authorization helper call. Add one of ${AUTHZ_HELPER_NAMES.join(", ")} (whichever this service already uses) before the handler touches the database, mark the route \`{ config: { public: true } }\` if it is genuinely intended to be open (see e.g. services/telephony-service/src/modules/webhooks/routes.ts for the house pattern), or if this is genuinely tracked debt being ported in, run --write-baseline.`,
    );
    failed = true;
  }
  if (staleEntries.length > 0) {
    console.log(
      `${RED}FAIL${RESET} -- ${staleEntries.length} baseline entr${staleEntries.length === 1 ? "y no longer reproduces" : "ies no longer reproduce"} -- regenerate with --write-baseline so a real fix can't be silently reverted for free:`,
    );
    for (const k of staleEntries) console.log(`  ${GREEN}${k}${RESET}  (no longer a violation, remove from baseline)`);
    failed = true;
  }
  if (!failed) {
    console.log(`${GREEN}PASS${RESET} -- no new violations, baseline is accurate (${knownDebt.length} tracked legacy entries remain).`);
  }

  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
