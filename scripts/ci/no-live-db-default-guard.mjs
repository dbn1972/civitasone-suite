#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// no-live-db-default-guard.mjs — tests never default to a live database (FQ15).
//
// THE GAP THIS CLOSES
// --------------------
// CI's `Tests` job runs Postgres on host port 5435 and exports PGHOST/PGPORT/
// PGUSER/PGPASSWORD (.github/workflows/ci.yml), so ~70 vitest configs and ~60
// test files grew a `localhost:5435` fallback ("matches CI"). On the shared
// dev/UAT host, 5435 IS the live database (container civitasone-postgres) and
// 6432 the pgbouncer in front of it. A test run with no DB env therefore
// connected to live UAT as civitas_admin (services/inventory-service: the
// data-quality test fell back to PGPORT 5435, and its vitest.config injected
// PGHOST/PGPORT=localhost:5435 into every worker).
//
// The fix routes every test DB host/port through vitest.testdb.ts
// (requireTestDb()/testDbHostPort()/hasTestDb()), which throws "test DB not
// configured" instead of guessing. This guard keeps the literal defaults from
// coming back.
//
// WHAT IT FLAGS (code lines only; `//`, `/*` and ` *` comment lines are ignored)
// ------------------------------------------------------------------------------
//   - a loopback host joined to a live port: localhost:5435, 127.0.0.1:6432, ...
//     (DSN literals such as "postgres://u:p@localhost:5435/db")
//   - a `??` / `||` fallback to a live port: PGPORT ?? "5435", port || 6432
//
// SCOPE
// -----
// Test code and test config only: files under any tests/ directory, *.test.* /
// *.spec.* files, vitest/jest config files, and the repo-root vitest.*.ts helpers.
// Literal ports that are not a connection default stay legal: a pgbouncer
// Helm-render assertion (`containerPort: 6432`), a refusal constant
// (`SHARED_INSTANCE_PORT = "5435"`), a non-loopback DSN (`@pgbouncer:6432/`).
// CI workflow YAML (.github/workflows/) is the ONE explicit allow: that is where
// CI legitimately provides PGPORT=5435 to its own throwaway service container.
//
// Usage: node scripts/ci/no-live-db-default-guard.mjs   (exit 1 on violations)
// Tests: tests/architecture/no-live-db-default-guard.test.ts
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

/** The live UAT ports on the shared host: Postgres and the pgbouncer in front of it. */
export const LIVE_DB_PORTS = ["5435", "6432"];

/** The only path prefixes allowed to mention a live port as a connection default. */
export const ALLOWED_PREFIXES = [".github/workflows/"];

const PORTS = LIVE_DB_PORTS.join("|");
const RULES = [
  {
    id: "loopback-live-port",
    re: new RegExp(String.raw`(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(?:${PORTS})(?!\d)`),
    reason: "hard-coded loopback host:port of the live database (use testDbHostPort() from vitest.testdb.ts)",
  },
  {
    id: "fallback-live-port",
    re: new RegExp(String.raw`(?:\?\?|\|\|)\s*["'\x60]?(?:${PORTS})["'\x60]?(?!\d)`),
    reason: "?? / || fallback to the live database port (use requireTestDb() from vitest.testdb.ts)",
  },
];

const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;

/** Is this repo-relative path test code or test config the guard covers? */
export function isInScope(relPath) {
  const p = relPath.replace(/\\/g, "/");
  if (ALLOWED_PREFIXES.some((pre) => p.startsWith(pre))) return false;
  if (/(^|\/)(node_modules|dist|archive)\//.test(p)) return false;
  if (!CODE_EXT.test(p)) return false;
  const base = p.split("/").pop();
  if (/^(vitest|jest)\.config\./.test(base)) return true;
  if (!p.includes("/") && /^vitest\./.test(base)) return true; // repo-root vitest.shared/drain/testdb
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) return true;
  if (/(^|\/)tests?\//.test(p)) return true;
  return false;
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

/** Violations in one source text: [{ line, rule, text, reason }]. */
export function findLiveDbDefaults(source) {
  const out = [];
  source.split("\n").forEach((line, i) => {
    if (isCommentLine(line)) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        out.push({ line: i + 1, rule: rule.id, text: line.trim(), reason: rule.reason });
        break;
      }
    }
  });
  return out;
}

/** Scan every tracked in-scope file under `root`. */
export function scanRepo(root = REPO_ROOT) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
    .filter(isInScope);
  const violations = [];
  for (const file of files) {
    let src;
    try {
      src = readFileSync(join(root, file), "utf8");
    } catch {
      continue; // deleted in the working tree but still in the index
    }
    for (const v of findLiveDbDefaults(src)) violations.push({ file, ...v });
  }
  return { scanned: files.length, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { scanned, violations } = scanRepo();
  if (violations.length) {
    console.error(`no-live-db-default-guard: ${violations.length} violation(s) in ${scanned} test/config files:`);
    for (const v of violations) console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.reason}\n      ${v.text}`);
    process.exit(1);
  }
  console.log(`no-live-db-default-guard: OK (${scanned} test/config files scanned)`);
}
