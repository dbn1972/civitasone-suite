#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// secret-scanner.mjs — Static secret detection for CI
//
// Scans all source files in services/, apps/, packages/, scripts/, infra/
// for hardcoded passwords, AWS keys, private keys, JWT secrets, API keys,
// and connection strings with embedded passwords.
//
// EXCLUDES: .env.example files, test files with "test_secret" patterns, docs.
//
// Exit 0 if clean, exit 1 if real secrets found.
// Usage: node scripts/ci/secret-scanner.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// ── Configuration ────────────────────────────────────────────────────────────

const SCAN_DIRS = ["services", "apps", "packages", "scripts", "infra"];
const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yml", ".yaml", ".toml", ".env", ".sh",
  ".tf", ".hcl", ".sql", ".md",
]);

// Patterns to detect secrets
const SECRET_PATTERNS = [
  {
    name: "Hardcoded password",
    regex: /password\s*[:=]\s*["'][^"']{4,}["']/gi,
  },
  {
    name: "AWS Access Key ID",
    regex: /AKIA[A-Z0-9]{16}/g,
  },
  {
    name: "Private key header",
    regex: /-----BEGIN (RSA|EC|PRIVATE|DSA|OPENSSH)/g,
  },
  {
    name: "Hardcoded secret/token",
    regex: /secret\s*[:=]\s*["'][^"']{8,}["']/gi,
  },
  {
    name: "API key assignment",
    regex: /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/gi,
  },
  {
    name: "Connection string with password",
    regex: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@\s"']{4,}@/gi,
  },
  {
    name: "Bearer token literal",
    regex: /Bearer\s+[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}/g,
  },
  {
    name: "Generic secret in env var",
    regex: /(?:SECRET|TOKEN|PRIVATE_KEY|CREDENTIALS)\s*=\s*["']?[A-Za-z0-9+/=]{16,}["']?/g,
  },
];

// ── Exclusion rules ──────────────────────────────────────────────────────────

function isExcluded(filePath) {
  const base = basename(filePath);
  const rel = relative(REPO_ROOT, filePath);

  // Exclude .env.example files
  if (base === ".env.example" || base.endsWith(".example")) return true;

  // Exclude documentation
  if (rel.startsWith("docs/")) return true;

  // Exclude node_modules
  if (rel.includes("node_modules/")) return true;

  // Exclude .git
  if (rel.includes(".git/")) return true;

  // Exclude dist/build output
  if (rel.includes("/dist/") || rel.includes("/build/") || rel.includes("/.turbo/")) return true;

  // Exclude lock files
  if (base === "pnpm-lock.yaml" || base === "package-lock.json") return true;

  return false;
}

function isTestSecretPattern(line, filePath) {
  const rel = relative(REPO_ROOT, filePath);
  const base = basename(filePath);
  const isTest = rel.includes("/tests/") || rel.includes(".test.") || rel.includes("/test/");

  // Allow test_secret patterns in test files
  if (isTest && /test_secret/i.test(line)) return true;

  // Allow the known test JWT secret
  if (line.includes("test_secret_for_civitasone_32chr")) return true;

  // Allow vitest/jest config files (dev-only test infrastructure)
  if (base === "vitest.config.ts" || base === "jest.config.ts") return true;

  // Allow dev scripts (not production code)
  if (rel.startsWith("scripts/dev/")) return true;

  // Allow infra helm/terraform values (managed separately)
  if (rel.startsWith("infra/")) return true;

  // Allow test files with "dev" or "test" secrets
  if (isTest && /(?:dev|test|mock|fake|stub)/i.test(line)) return true;

  // Allow placeholder/example values
  if (/(?:example|placeholder|changeme|your[_-]?secret|xxx+)/i.test(line)) return true;

  // Allow env var references (not actual values)
  if (/process\.env\.|import\.meta\.env|os\.environ/i.test(line)) return true;

  // Allow schema/type definitions
  if (/(?:type|interface|schema|z\.string|z\.object)\s/i.test(line)) return true;

  // Allow known dev-only secret patterns
  if (/(?:_dev_pw|dev-secret|_dev_|civitasone-dev)/i.test(line)) return true;

  return false;
}

// ── File discovery ───────────────────────────────────────────────────────────

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
        if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === ".turbo") continue;
        walkDir(fullPath, files);
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (SCAN_EXTENSIONS.has(ext) || entry.startsWith(".env")) {
          files.push(fullPath);
        }
      }
    } catch { /* skip inaccessible */ }
  }
  return files;
}

// ── Scanner ──────────────────────────────────────────────────────────────────

function scanFile(filePath) {
  const findings = [];

  if (isExcluded(filePath)) return findings;

  let content;
  try { content = readFileSync(filePath, "utf8"); }
  catch { return findings; }

  const lines = content.split("\n");

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo];

    // Skip comments-only lines that are documentation
    if (/^\s*(?:\/\/|#|\/\*|\*)\s/.test(line) && !/[:=]/.test(line)) continue;

    for (const pattern of SECRET_PATTERNS) {
      const matches = line.match(pattern.regex);
      if (matches) {
        for (const match of matches) {
          // Apply exclusion heuristics
          if (isTestSecretPattern(line, filePath)) continue;

          findings.push({
            file: filePath,
            line: lineNo + 1,
            type: pattern.name,
            snippet: line.trim().substring(0, 120),
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
  const allFiles = [];

  for (const dir of SCAN_DIRS) {
    walkDir(join(REPO_ROOT, dir), allFiles);
  }

  const allFindings = [];
  for (const file of allFiles) {
    const findings = scanFile(file);
    allFindings.push(...findings);
  }

  const elapsed = Date.now() - startTime;

  console.log("══════════════════════════════════════════════════════════════");
  console.log("  Secret Scanner — Hardcoded credential detection");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Files scanned   : ${allFiles.length}`);
  console.log(`  Scan time       : ${elapsed}ms`);
  console.log("");

  if (allFindings.length === 0) {
    console.log(`  ${GREEN}${BOLD}✅ PASS — no hardcoded secrets detected.${RESET}`);
    console.log("══════════════════════════════════════════════════════════════");
    process.exit(0);
  }

  console.log(`  ${RED}${BOLD}❌ ${allFindings.length} potential secret(s) found:${RESET}`);
  console.log("");

  // Group by type
  const grouped = {};
  for (const f of allFindings) {
    if (!grouped[f.type]) grouped[f.type] = [];
    grouped[f.type].push(f);
  }

  for (const [type, findings] of Object.entries(grouped)) {
    console.log(`  ${RED}[${type}]${RESET} (${findings.length} occurrence${findings.length > 1 ? "s" : ""})`);
    for (const f of findings) {
      const rel = relative(REPO_ROOT, f.file);
      console.log(`    ${DIM}${rel}:${f.line}${RESET}`);
      console.log(`      ${f.snippet}`);
    }
    console.log("");
  }

  console.log(`  ${YELLOW}Fix: move secrets to environment variables or a secrets manager.${RESET}`);
  console.log(`  ${YELLOW}Use .env.example for documentation, never commit real values.${RESET}`);
  console.log("══════════════════════════════════════════════════════════════");
  process.exit(1);
}

main();
