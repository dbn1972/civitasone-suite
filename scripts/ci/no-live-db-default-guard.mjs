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
//   - a template-literal host joined to a live port: `postgres://u@${host}:5435/db`
//   - a `??` / `||` fallback to a live port: PGPORT ?? "5435", port || 6432
//   - a connection-object port: { host, port: 5435 } (a `host:` key on the same
//     line or within 2 lines, so display-only mocks such as a pgbouncer status
//     card's `{ configured: true, port: 6432 }` stay legal)
//   - a port constant: const PORT = 5435, let pgPort = "6432" (constants whose
//     name says they are the port to REFUSE, e.g. SHARED_INSTANCE_PORT, stay legal)
// Deliberate obfuscation ("543" + "5") is out of scope: this catches accidents.
//
// SCOPE
// -----
// Test code and test config only: files under any tests/ or e2e/ directory,
// *.test.* / *.spec.* files, vitest/jest/playwright config files (including
// vitest.<name>.config.*), vitest/global setup files, and the repo-root vitest.*
// helpers. Literal ports that are not a connection default stay legal: a
// pgbouncer Helm-render assertion (`containerPort:\s*6432` in a regex), a
// refusal constant, a non-loopback DSN (`@pgbouncer:6432/`).
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
const Q = "[\"'\\x60]"; // ", ' or `
const PORT_END = "(?!\\d)";
/** Constant names that hold the port to refuse, not a port to connect to. */
const REFUSAL_NAME = /SHARED|LIVE|REFUS|FORBID|DENY|BLOCK|UAT/i;

const RULES = [
  {
    id: "loopback-live-port",
    re: new RegExp(String.raw`(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(?:${PORTS})${PORT_END}`),
    reason: "hard-coded loopback host:port of the live database (use testDbHostPort() from vitest.testdb.ts)",
  },
  {
    id: "template-host-live-port",
    re: new RegExp(String.raw`\$\{[^}]+\}:(?:${PORTS})${PORT_END}`),
    reason: "DSN template with a live database port (use testDbHostPort() from vitest.testdb.ts)",
  },
  {
    id: "fallback-live-port",
    re: new RegExp(String.raw`(?:\?\?|\|\|)\s*${Q}?(?:${PORTS})${Q}?${PORT_END}`),
    reason: "?? / || fallback to the live database port (use requireTestDb() from vitest.testdb.ts)",
  },
  {
    id: "connection-object-live-port",
    re: new RegExp(String.raw`\bport\s*:\s*${Q}?(?:${PORTS})${Q}?${PORT_END}`, "i"),
    // Only a connection object: a `host:` key on this line or within 2 lines.
    when: (lines, i) => lines.slice(Math.max(0, i - 2), i + 3).some((l) => /\bhost(name)?\s*:/i.test(l)),
    reason: "connection object with a live database port (use requireTestDb() from vitest.testdb.ts)",
  },
  {
    id: "constant-live-port",
    re: new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*${Q}?(?:${PORTS})${Q}?\s*[;,)]?\s*$`),
    when: (lines, i, m) => !REFUSAL_NAME.test(m[1]),
    reason: "port constant set to the live database port (use requireTestDb() from vitest.testdb.ts)",
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
  if (/^(vitest|jest|playwright)(\.[\w-]+)*\.config\./.test(base)) return true; // incl. vitest.cer.config.ts
  if (/^(vitest|jest)\.(setup|workspace)\./.test(base)) return true;
  if (/^(global-)?setup([.-][\w-]+)?\.[cm]?[jt]sx?$/.test(base) || /\.setup\.[cm]?[jt]sx?$/.test(base)) return true;
  if (!p.includes("/") && /^vitest\./.test(base)) return true; // repo-root vitest.shared/drain/testdb
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) return true;
  if (/(^|\/)(tests?|e2e)\//.test(p)) return true;
  return false;
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

/** Violations in one source text: [{ line, rule, text, reason }]. */
export function findLiveDbDefaults(source) {
  const out = [];
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    if (isCommentLine(line)) return;
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (m && (!rule.when || rule.when(lines, i, m))) {
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
