#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// arch-guard.mjs — DB-per-service isolation guard (gap 06-T2)
//
// Each CivitasOne service owns its own database (`civitas_<svc>`) and DB role
// (`<svc>_svc`). Isolation is enforced at runtime, but nothing in CI stops a
// developer from quietly reaching across the boundary in source. This guard
// closes that gap: it scans every `services/<a>-service/src/**/*.ts` and FAILS
// (exit 1) if a service touches *another* service's territory.
//
// It flags two violations:
//   (a) DB CROSS-REF   — a literal reference to another service's database name
//                        `civitas_<b>` (b !== a).
//   (b) CROSS IMPORT   — a relative/path import that reaches into another
//                        service, e.g. `from "../../<b>-service/..."` or
//                        `from "../../../services/<b>-service/..."` (b !== a).
//
// Allowlisted (never flagged):
//   - self references: `civitas_<a>` and `<a>-service/...` within service <a>.
//   - shared packages: any specifier starting with `@civitasone/`.
//   - infra DB names that are not a known service (e.g. `civitas_test`).
//
// Best-effort: line and block comments are stripped before matching, and
// `dist/`, `node_modules/`, and test files (`*.test.ts`, `*.spec.ts`) are
// skipped. Pure Node ESM, no external dependencies.
//
// Usage:  node scripts/ci/arch-guard.mjs            (from repo root)
// Exit:   0 when clean, 1 when any violation is found.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ci/arch-guard.mjs  ->  repo root is two levels up.
const REPO_ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");

// ── 1. Discover services and their owned DB names ───────────────────────────
// A service folder is `services/<svc>-service`; its DB is `civitas_<svc>`.
function discoverServices() {
  if (!existsSync(SERVICES_DIR)) {
    console.error(`arch-guard: services directory not found at ${SERVICES_DIR}`);
    process.exit(1);
  }
  const names = readdirSync(SERVICES_DIR)
    .filter((d) => d.endsWith("-service"))
    .filter((d) => {
      try {
        return statSync(join(SERVICES_DIR, d)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((d) => d.slice(0, -"-service".length))
    .filter(Boolean);
  return new Set(names);
}

const SERVICES = discoverServices();

// ── 2. File walking ─────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".turbo", "coverage"]);

function isSkippedFile(name) {
  return (
    name.endsWith(".test.ts") ||
    name.endsWith(".spec.ts") ||
    name.endsWith(".d.ts")
  );
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

// ── 3. Comment stripping (best-effort) ──────────────────────────────────────
// Removes /* ... */ block comments (possibly multi-line) and // line comments,
// while preserving overall line count so reported line numbers stay accurate.
// String literals are not perfectly respected, but for `//` inside strings we
// only risk *under*-reporting on that line, which keeps the guard conservative.
function stripComments(source) {
  const out = [];
  let inBlock = false;
  for (const rawLine of source.split("\n")) {
    let line = rawLine;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        out.push(""); // entire line is inside a block comment
        continue;
      }
      line = " ".repeat(end + 2) + line.slice(end + 2);
      inBlock = false;
    }
    // Remove inline block comments on this line; handle an unterminated one.
    let result = "";
    let i = 0;
    while (i < line.length) {
      const two = line.slice(i, i + 2);
      if (two === "/*") {
        const end = line.indexOf("*/", i + 2);
        if (end === -1) {
          inBlock = true;
          break; // rest of line is comment
        }
        result += " ".repeat(end + 2 - i);
        i = end + 2;
      } else if (two === "//") {
        break; // rest of line is a line comment
      } else {
        result += line[i];
        i += 1;
      }
    }
    out.push(result);
  }
  return out;
}

// ── 4. Violation detection ───────────────────────────────────────────────────
// (a) DB cross-reference: civitas_<b> where b is another known service.
const DB_RE = /civitas_([a-z][a-z0-9_]*)/g;

// (b) Cross-service import: capture module specifiers from import/from/require
// and dynamic import(), then look for `<b>-service` segments.
const SPECIFIER_RE = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const SERVICE_SEG_RE = /(?:^|[\/\\])([a-z][a-z0-9-]*?)-service(?:[\/\\]|['"]?$)/g;

function checkFile(filePath, ownService) {
  const violations = [];
  const source = readFileSync(filePath, "utf8");
  const lines = stripComments(source);

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;

    // (a) DB name cross-reference
    DB_RE.lastIndex = 0;
    let m;
    while ((m = DB_RE.exec(line)) !== null) {
      const target = m[1];
      if (SERVICES.has(target) && target !== ownService) {
        violations.push({
          type: "DB-CROSS-REF",
          line: lineNo,
          target,
          snippet: `civitas_${target}`,
        });
      }
    }

    // (b) Cross-service import specifiers
    SPECIFIER_RE.lastIndex = 0;
    let s;
    while ((s = SPECIFIER_RE.exec(line)) !== null) {
      const spec = s[1];
      // Shared packages are always allowed.
      if (spec.startsWith("@civitasone/")) continue;

      SERVICE_SEG_RE.lastIndex = 0;
      let seg;
      while ((seg = SERVICE_SEG_RE.exec(spec)) !== null) {
        const target = seg[1];
        if (SERVICES.has(target) && target !== ownService) {
          violations.push({
            type: "CROSS-IMPORT",
            line: lineNo,
            target,
            snippet: spec,
          });
        }
      }
    }
  });

  return violations;
}

// ── 5. Run ────────────────────────────────────────────────────────────────────
function main() {
  const allViolations = [];
  let filesScanned = 0;

  for (const svc of [...SERVICES].sort()) {
    const srcDir = join(SERVICES_DIR, `${svc}-service`, "src");
    if (!existsSync(srcDir)) continue;
    for (const file of walkTsFiles(srcDir)) {
      filesScanned += 1;
      const found = checkFile(file, svc);
      for (const v of found) {
        allViolations.push({ file, owner: svc, ...v });
      }
    }
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Architecture Guard — DB-per-service isolation (gap 06-T2)");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Services discovered : ${SERVICES.size}`);
  console.log(`  Source files scanned: ${filesScanned}`);
  console.log("");

  if (allViolations.length === 0) {
    console.log("  ✅ CLEAN — no cross-service DB references or imports found.");
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  console.log(`  ❌ ${allViolations.length} cross-service violation(s) detected:`);
  console.log("");
  for (const v of allViolations) {
    const rel = relative(REPO_ROOT, v.file).split(sep).join("/");
    const reason =
      v.type === "DB-CROSS-REF"
        ? `references another service's database "${v.snippet}"`
        : `imports into another service "${v.snippet}"`;
    console.log(`  [${v.type}] ${rel}:${v.line}`);
    console.log(`      ${v.owner}-service ${reason} (owned by ${v.target}-service)`);
  }
  console.log("");
  console.log(`  DB-per-service isolation must hold. Use the gateway or events`);
  console.log(`  to cross service boundaries — never a direct DB/import reach-in.`);
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(1);
}

main();
