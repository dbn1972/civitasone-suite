#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// sql-injection-guard.mjs — Static SQL injection pattern detector
//
// Scans all services/*/src/**/*.ts files for unsafe SQL construction patterns.
// Drizzle ORM's sql`` tagged template safely parameterizes ${} interpolations,
// BUT certain patterns are still unsafe:
//   - String concatenation inside sql`` (table/column names from user input)
//   - Direct use of req.params/req.body/req.query inside sql``
//   - Raw string template literals used for SQL without the sql tag
//
// Exit 0 if clean, exit 1 if unsafe patterns found.
// Usage: node scripts/ci/sql-injection-guard.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// ── File Discovery ───────────────────────────────────────────────────────────

function walkDir(dir, files = []) {
  if (!existsSync(dir)) return files;

  let entries;
  try { entries = readdirSync(dir); }
  catch { return files; }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
        walkDir(fullPath, files);
      } else if (stat.isFile() && extname(entry) === ".ts") {
        files.push(fullPath);
      }
    } catch { /* skip */ }
  }
  return files;
}

// ── Unsafe Patterns ──────────────────────────────────────────────────────────

const UNSAFE_PATTERNS = [
  {
    name: "Direct req.params in SQL",
    description: "sql`` template uses req.params directly — attacker-controlled input",
    regex: /sql\s*`[^`]*\$\{[^}]*req\.params[^}]*\}[^`]*`/g,
    severity: "HIGH",
  },
  {
    name: "Direct req.body in SQL",
    description: "sql`` template uses req.body directly — attacker-controlled input",
    regex: /sql\s*`[^`]*\$\{[^}]*req\.body[^}]*\}[^`]*`/g,
    severity: "HIGH",
  },
  {
    name: "Direct req.query in SQL",
    description: "sql`` template uses req.query directly — attacker-controlled input",
    regex: /sql\s*`[^`]*\$\{[^}]*req\.query[^}]*\}[^`]*`/g,
    severity: "HIGH",
  },
  {
    name: "String concatenation in SQL template",
    description: "String concatenation (+) inside sql`` can bypass parameterization",
    regex: /sql\s*`[^`]*\$\{[^}]*\+[^}]*\}[^`]*`/g,
    severity: "MEDIUM",
  },
  {
    name: "Template literal for SQL without sql tag",
    description: "Untagged template literal with SELECT/INSERT/UPDATE/DELETE — not parameterized",
    regex: /(?<!sql\s*)`(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{[^}]+\}[^`]*`/gi,
    severity: "HIGH",
  },
  {
    name: "db.execute with raw string",
    description: "db.execute() with a plain string (not sql-tagged template) — unparameterized",
    regex: /db\.execute\s*\(\s*(?:["']|`)[^)]*\)/g,
    severity: "HIGH",
  },
  {
    name: "sql.raw with user input",
    description: "sql.raw() bypasses parameterization — verify input is not user-controlled",
    regex: /sql\.raw\s*\([^)]*(?:req\.|params|body|query|input|payload)[^)]*\)/g,
    severity: "HIGH",
  },
  {
    name: "Dynamic table/column via sql.raw",
    description: "sql.raw() usage (review manually for user input)",
    regex: /sql\.raw\s*\(\s*(?!['"](?:ASC|DESC|AND|OR|TRUE|FALSE|NULL|,|\s)+['"])[^)]+\)/g,
    severity: "LOW",
  },
];

// ── Safe pattern whitelist ───────────────────────────────────────────────────

function isSafeLine(line) {
  // sql.raw with static strings is safe
  if (/sql\.raw\s*\(\s*['"][^'"]*['"]\s*\)/.test(line)) return true;

  // Comments
  if (/^\s*\/\//.test(line)) return true;

  // Migration files (static DDL)
  return false;
}

// ── Scanner ──────────────────────────────────────────────────────────────────

function scanFile(filePath) {
  const findings = [];
  const rel = relative(REPO_ROOT, filePath);

  // Skip test files — they often have intentional patterns
  if (rel.includes("/tests/") || rel.includes(".test.") || rel.includes(".spec.")) return findings;

  // Skip migration files — they contain static DDL
  if (rel.includes("/migrations/")) return findings;

  let content;
  try { content = readFileSync(filePath, "utf8"); }
  catch { return findings; }

  const lines = content.split("\n");

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo];

    if (isSafeLine(line)) continue;

    for (const pattern of UNSAFE_PATTERNS) {
      // Reset regex lastIndex
      pattern.regex.lastIndex = 0;
      const matches = line.match(pattern.regex);
      if (matches) {
        for (const match of matches) {
          // Double-check: skip if line has a whitelist comment
          if (line.includes("// sql-injection-safe")) continue;

          findings.push({
            file: filePath,
            line: lineNo + 1,
            pattern: pattern.name,
            severity: pattern.severity,
            description: pattern.description,
            snippet: line.trim().substring(0, 140),
          });
        }
      }
    }
  }

  return findings;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const startTime = Date.now();

  if (!existsSync(SERVICES_DIR)) {
    console.error(`${RED}ERROR: services/ directory not found at ${SERVICES_DIR}${RESET}`);
    process.exit(1);
  }

  const services = readdirSync(SERVICES_DIR).filter((d) => {
    try { return d.endsWith("-service") && statSync(join(SERVICES_DIR, d)).isDirectory(); }
    catch { return false; }
  });

  const allFiles = [];
  for (const svc of services) {
    const srcDir = join(SERVICES_DIR, svc, "src");
    walkDir(srcDir, allFiles);
  }

  const allFindings = [];
  for (const file of allFiles) {
    allFindings.push(...scanFile(file));
  }

  const elapsed = Date.now() - startTime;

  // Separate by severity
  const high = allFindings.filter((f) => f.severity === "HIGH");
  const medium = allFindings.filter((f) => f.severity === "MEDIUM");
  const low = allFindings.filter((f) => f.severity === "LOW");

  console.log("══════════════════════════════════════════════════════════════");
  console.log("  SQL Injection Guard — Unsafe SQL pattern detection");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Services scanned : ${services.length}`);
  console.log(`  Files scanned    : ${allFiles.length}`);
  console.log(`  Scan time        : ${elapsed}ms`);
  console.log("");
  console.log(`  HIGH severity    : ${high.length}`);
  console.log(`  MEDIUM severity  : ${medium.length}`);
  console.log(`  LOW severity     : ${low.length}`);
  console.log("");

  if (high.length === 0 && medium.length === 0) {
    console.log(`  ${GREEN}${BOLD}✅ PASS — no unsafe SQL injection patterns detected.${RESET}`);
    if (low.length > 0) {
      console.log(`  ${YELLOW}ℹ️  ${low.length} low-severity finding(s) — review recommended:${RESET}`);
      for (const f of low) {
        const rel = relative(REPO_ROOT, f.file);
        console.log(`    ${DIM}${rel}:${f.line}${RESET} ${f.pattern}`);
      }
    }
    console.log("══════════════════════════════════════════════════════════════");
    process.exit(0);
  }

  console.log(`  ${RED}${BOLD}❌ FAIL — ${high.length + medium.length} unsafe SQL pattern(s):${RESET}`);
  console.log("");

  for (const f of [...high, ...medium]) {
    const rel = relative(REPO_ROOT, f.file);
    const sevColor = f.severity === "HIGH" ? RED : YELLOW;
    console.log(`  ${sevColor}[${f.severity}]${RESET} ${f.pattern}`);
    console.log(`    ${DIM}${rel}:${f.line}${RESET}`);
    console.log(`    ${f.description}`);
    console.log(`    ${DIM}${f.snippet}${RESET}`);
    console.log("");
  }

  console.log(`  ${YELLOW}Fix: use Drizzle ORM's parameterized queries instead of string interpolation.${RESET}`);
  console.log(`  ${YELLOW}Add '// sql-injection-safe' comment to whitelist verified-safe patterns.${RESET}`);
  console.log("══════════════════════════════════════════════════════════════");
  process.exit(1);
}

main();
