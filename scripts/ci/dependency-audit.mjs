#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// dependency-audit.mjs — Dependency hygiene & supply-chain safety check
//
// Checks:
//   1. pnpm-lock.yaml exists (dependencies are pinned)
//   2. No package.json uses "*" or "latest" version ranges
//   3. All @civitasone/* packages are workspace references (not npm-published)
//   4. Typosquatting detection for common misspellings of popular packages
//   5. Total dependency count report
//
// Exit 0 if clean, exit 1 if unsafe version ranges or supply chain issues found.
// Usage: node scripts/ci/dependency-audit.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
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

// ── Known typosquatting patterns ─────────────────────────────────────────────

const TYPOSQUAT_MAP = {
  // Real package → common typosquats
  "lodash": ["lodahs", "loadash", "lodas", "lod-ash", "lodashs"],
  "express": ["expres", "expresss", "exress", "exppress"],
  "fastify": ["fasitfy", "fastfy", "fastifi", "fastifly"],
  "react": ["raect", "reacr", "reactt", "rreact"],
  "axios": ["axois", "axioss", "axio", "axos"],
  "zod": ["zodd", "zodt"],
  "drizzle-orm": ["drizzle-om", "drizzle-orrm", "drizle-orm", "drizzleorm"],
  "jsonwebtoken": ["json-webtoken", "jsonwetoken", "jssonwebtoken"],
  "typescript": ["typescipt", "tyepscript", "typscript", "typescrip"],
  "vitest": ["vittes", "vites", "vitestt"],
  "pg": ["pgg", "pgp", "p-g"],
  "redis": ["rediis", "rediss", "reedis"],
  "next": ["nextt", "nex", "nexts"],
  "tailwindcss": ["tailwind-css", "tailwindcs", "tailiwindcss"],
  "eslint": ["esllint", "eslnt", "es-lint"],
  "prettier": ["pretier", "prettierr", "pretter"],
};

// Build a flat set of all known typosquats
const ALL_TYPOSQUATS = new Set();
for (const variants of Object.values(TYPOSQUAT_MAP)) {
  for (const v of variants) ALL_TYPOSQUATS.add(v);
}

// ── Package.json discovery ───────────────────────────────────────────────────

function findPackageJsons(dir, files = []) {
  if (!existsSync(dir)) return files;

  let entries;
  try { entries = readdirSync(dir); }
  catch { return files; }

  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === ".turbo") continue;
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        findPackageJsons(fullPath, files);
      } else if (entry === "package.json") {
        files.push(fullPath);
      }
    } catch { /* skip */ }
  }
  return files;
}

// ── Checks ───────────────────────────────────────────────────────────────────

function checkLockFile() {
  const lockPath = join(REPO_ROOT, "pnpm-lock.yaml");
  if (existsSync(lockPath)) {
    return { pass: true, message: "pnpm-lock.yaml exists (deps pinned)" };
  }
  return { pass: false, message: "pnpm-lock.yaml missing — dependencies are not pinned!" };
}

function checkPackageJson(filePath) {
  const issues = [];
  let content;
  try { content = JSON.parse(readFileSync(filePath, "utf8")); }
  catch { return issues; }

  const depSections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

  for (const section of depSections) {
    const deps = content[section];
    if (!deps || typeof deps !== "object") continue;

    for (const [pkg, version] of Object.entries(deps)) {
      // Check for wildcard/latest
      if (version === "*" || version === "latest") {
        issues.push({
          type: "UNSAFE_VERSION",
          pkg,
          version,
          section,
          message: `"${pkg}": "${version}" — unpinned, can install arbitrary version`,
        });
      }

      // Check @civitasone/* packages are workspace references
      if (pkg.startsWith("@civitasone/")) {
        if (!version.startsWith("workspace:")) {
          issues.push({
            type: "NON_WORKSPACE_INTERNAL",
            pkg,
            version,
            section,
            message: `"${pkg}": "${version}" — should be "workspace:*" (internal package)`,
          });
        }
      }

      // Typosquatting check
      const baseName = pkg.startsWith("@") ? pkg.split("/").pop() : pkg;
      if (ALL_TYPOSQUATS.has(baseName)) {
        issues.push({
          type: "TYPOSQUAT",
          pkg,
          version,
          section,
          message: `"${pkg}" — potential typosquat of a popular package`,
        });
      }
    }
  }

  return issues;
}

function countDependencies() {
  const rootPkg = join(REPO_ROOT, "package.json");
  if (!existsSync(rootPkg)) return 0;
  try {
    const content = JSON.parse(readFileSync(rootPkg, "utf8"));
    const deps = content.dependencies ? Object.keys(content.dependencies).length : 0;
    const devDeps = content.devDependencies ? Object.keys(content.devDependencies).length : 0;
    return deps + devDeps;
  } catch { return 0; }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const startTime = Date.now();

  const packageJsons = findPackageJsons(REPO_ROOT);
  const lockResult = checkLockFile();

  const allIssues = [];
  let totalDeps = 0;

  for (const pkgPath of packageJsons) {
    const issues = checkPackageJson(pkgPath);
    for (const issue of issues) {
      allIssues.push({ ...issue, file: pkgPath });
    }

    // Count total deps across all package.jsons
    try {
      const content = JSON.parse(readFileSync(pkgPath, "utf8"));
      for (const section of ["dependencies", "devDependencies"]) {
        if (content[section]) totalDeps += Object.keys(content[section]).length;
      }
    } catch { /* skip */ }
  }

  const elapsed = Date.now() - startTime;

  // Categorize
  const unsafeVersions = allIssues.filter((i) => i.type === "UNSAFE_VERSION");
  const nonWorkspace = allIssues.filter((i) => i.type === "NON_WORKSPACE_INTERNAL");
  const typosquats = allIssues.filter((i) => i.type === "TYPOSQUAT");

  console.log("══════════════════════════════════════════════════════════════");
  console.log("  Dependency Audit — Supply-chain safety check");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Package.json files : ${packageJsons.length}`);
  console.log(`  Total dependencies : ${totalDeps}`);
  console.log(`  Scan time          : ${elapsed}ms`);
  console.log("");
  console.log(`  Lock file          : ${lockResult.pass ? `${GREEN}✓` : `${RED}✗`} ${lockResult.message}${RESET}`);
  console.log(`  Unsafe versions    : ${unsafeVersions.length === 0 ? `${GREEN}✓ none` : `${RED}✗ ${unsafeVersions.length}`}${RESET}`);
  console.log(`  Non-workspace @c1  : ${nonWorkspace.length === 0 ? `${GREEN}✓ none` : `${RED}✗ ${nonWorkspace.length}`}${RESET}`);
  console.log(`  Typosquats         : ${typosquats.length === 0 ? `${GREEN}✓ none` : `${RED}✗ ${typosquats.length}`}${RESET}`);
  console.log("");

  const hasBlockers = !lockResult.pass || unsafeVersions.length > 0 || typosquats.length > 0;

  if (!hasBlockers && nonWorkspace.length === 0) {
    console.log(`  ${GREEN}${BOLD}✅ PASS — all dependency checks passed.${RESET}`);
    console.log("══════════════════════════════════════════════════════════════");
    process.exit(0);
  }

  if (allIssues.length > 0) {
    console.log(`  ${RED}${BOLD}Issues found:${RESET}`);
    console.log("");

    for (const issue of allIssues) {
      const rel = relative(REPO_ROOT, issue.file);
      const color = issue.type === "TYPOSQUAT" ? RED : (issue.type === "UNSAFE_VERSION" ? RED : YELLOW);
      console.log(`  ${color}[${issue.type}]${RESET} ${rel}`);
      console.log(`    ${issue.message}`);
      console.log("");
    }
  }

  if (!lockResult.pass) {
    console.log(`  ${RED}[LOCK_MISSING]${RESET} ${lockResult.message}`);
    console.log("");
  }

  if (hasBlockers) {
    console.log(`  ${RED}${BOLD}❌ FAIL — blocking issues found.${RESET}`);
    console.log(`  ${YELLOW}Fix: pin all versions, use workspace:* for internal packages.${RESET}`);
    console.log("══════════════════════════════════════════════════════════════");
    process.exit(1);
  }

  // Non-workspace warnings are non-blocking but worth noting
  console.log(`  ${YELLOW}${BOLD}⚠️  WARN — non-blocking issues found. Review recommended.${RESET}`);
  console.log("══════════════════════════════════════════════════════════════");
  process.exit(0);
}

main();
