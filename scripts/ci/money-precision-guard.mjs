#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// money-precision-guard.mjs — Number() coercion detector for monetary values
//
// Scans all services/*/src/**/*.ts files and flags any Number() call that
// operates on a variable/property containing money-related names:
//   Minor, Amount, Paise, minor, amount, paise
//
// This catches the most common precision bug: accidentally converting a bigint
// monetary value to a JavaScript Number, which silently truncates above 2^53.
//
// EXCLUDES:
//   - Lines with `// bigint-safe` or `// precision-ok` comment
//   - Test files (*.test.ts, *.spec.ts)
//   - Declaration files (*.d.ts)
//   - node_modules/
//   - queries.ts files (display/read path — acceptable, documented)
//
// Exit behavior:
//   - Exit 1 if violations found in NON-query files (commands, consumers, domain)
//   - Exit 0 if violations are ONLY in queries.ts (read/display path)
//   - Exit 0 if no violations at all
//
// Usage: node scripts/ci/money-precision-guard.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// ── 1. File walking ──────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".turbo", "coverage"]);

function* walkTsFiles(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walkTsFiles(full);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      // Skip test files, declaration files
      if (entry.name.endsWith(".test.ts")) continue;
      if (entry.name.endsWith(".spec.ts")) continue;
      if (entry.name.endsWith(".d.ts")) continue;
      yield full;
    }
  }
}

function discoverSourceFiles() {
  const files = [];
  if (!existsSync(SERVICES_DIR)) return files;

  const services = readdirSync(SERVICES_DIR).filter((d) => {
    try { return d.endsWith("-service") && statSync(join(SERVICES_DIR, d)).isDirectory(); }
    catch { return false; }
  });

  for (const svc of services) {
    const srcDir = join(SERVICES_DIR, svc, "src");
    if (!existsSync(srcDir)) continue;
    for (const file of walkTsFiles(srcDir)) {
      files.push(file);
    }
  }
  return files;
}

// ── 2. Detect Number() on monetary values ────────────────────────────────────

// Pattern: Number(somethingMinor) or Number(x.amountMinor) etc.
// We match Number( followed by an expression containing money-related words
const MONEY_WORDS = /[Mm]inor|[Aa]mount|[Pp]aise/;

// Match Number(...) calls — capture the argument
const NUMBER_CALL_RE = /\bNumber\s*\(([^)]+)\)/g;

function analyzeFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  const lines = source.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip whitelisted lines
    if (line.includes("// bigint-safe") || line.includes("// precision-ok")) continue;

    // Find Number() calls
    NUMBER_CALL_RE.lastIndex = 0;
    let match;
    while ((match = NUMBER_CALL_RE.exec(line)) !== null) {
      const arg = match[1];
      if (MONEY_WORDS.test(arg)) {
        violations.push({
          line: i + 1,
          expression: match[0].trim(),
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }

  return violations;
}

// ── 3. Run ────────────────────────────────────────────────────────────────────
function main() {
  const sourceFiles = discoverSourceFiles();
  const writePathViolations = [];  // commands, consumers, domain — FAIL
  const readPathViolations = [];   // queries.ts — WARN only
  let filesScanned = 0;

  for (const file of sourceFiles) {
    filesScanned++;
    const violations = analyzeFile(file);
    if (violations.length === 0) continue;

    const isQueryFile = basename(file) === "queries.ts";

    for (const v of violations) {
      const entry = { file, ...v };
      if (isQueryFile) {
        readPathViolations.push(entry);
      } else {
        writePathViolations.push(entry);
      }
    }
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Money Precision Guard — Number() coercion detector");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Source files scanned: ${filesScanned}`);
  console.log("");

  if (writePathViolations.length === 0 && readPathViolations.length === 0) {
    console.log(`  ${GREEN}✅ PASS — no Number() coercion on monetary values found.${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  // Report write-path violations (FAIL)
  if (writePathViolations.length > 0) {
    console.log(`  ${RED}${BOLD}❌ ${writePathViolations.length} write-path violation(s) (BLOCKING):${RESET}`);
    console.log("");
    for (const v of writePathViolations) {
      const rel = relative(REPO_ROOT, v.file);
      console.log(`  ${RED}[PRECISION]${RESET} ${rel}:${v.line}`);
      console.log(`      ${v.expression}`);
      console.log(`      ${DIM}${v.snippet}${RESET}`);
      console.log("");
    }
  }

  // Report read-path violations (WARN only)
  if (readPathViolations.length > 0) {
    console.log(`  ${YELLOW}⚠️  ${readPathViolations.length} read-path occurrence(s) in queries.ts (acceptable):${RESET}`);
    console.log("");
    for (const v of readPathViolations) {
      const rel = relative(REPO_ROOT, v.file);
      console.log(`  ${YELLOW}[DISPLAY]${RESET} ${rel}:${v.line}`);
      console.log(`      ${DIM}${v.expression}${RESET}`);
    }
    console.log("");
  }

  // Exit decision
  if (writePathViolations.length > 0) {
    console.log(`  ${RED}Fix: use BigInt() instead of Number() for monetary values,${RESET}`);
    console.log(`  ${RED}or add // bigint-safe or // precision-ok to suppress.${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(1);
  }

  // Only read-path violations — acceptable
  console.log(`  ${GREEN}✅ PASS — write-path is clean. Read-path display coercions are documented.${RESET}`);
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(0);
}

main();
