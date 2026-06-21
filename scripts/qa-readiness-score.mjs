#!/usr/bin/env node
/**
 * QA readiness score — testing, security, and production risk (100 = ready).
 *
 * Usage:
 *   node scripts/qa-readiness-score.mjs [--min-score 95] [--json]
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const minScore = Number(args[args.indexOf("--min-score") + 1] ?? 0);
const jsonOut = args.includes("--json");

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function exists(path) {
  return existsSync(join(ROOT, path));
}

function listServices() {
  const dir = join(ROOT, "services");
  return readdirSync(dir).filter((d) => {
    try {
      return statSync(join(dir, d, "src", "app.ts")).isFile();
    } catch {
      return false;
    }
  });
}

function walkRoutes(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkRoutes(p, acc);
    else if (ent.name === "routes.ts") acc.push(p);
  }
  return acc;
}

function gitTracked(path) {
  try {
    execSync(`git ls-files --error-unmatch ${path}`, { cwd: ROOT, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function resolveUpstream(gatewayPath, routes) {
  const pathname = gatewayPath.split("?")[0] ?? gatewayPath;
  const sorted = [...routes].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const route of sorted) {
    if (pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)) {
      const remainder = pathname.slice(route.prefix.length) || "/";
      const basePath = route.upstreamPath ?? route.prefix.replace(/^\/api/, "");
      return `${basePath}${remainder}`;
    }
  }
  return null;
}

function parseRegistry() {
  const src = read("services/gateway-service/src/registry.ts");
  const routes = [];
  for (const block of src.split(/\{\s*name:/).slice(1)) {
    const name = block.match(/^\s*"([^"]+)"/)?.[1];
    const prefix = block.match(/prefix:\s*"([^"]+)"/)?.[1];
    const upstreamPath = block.match(/upstreamPath:\s*"([^"]+)"/)?.[1];
    if (name && prefix) routes.push({ name, prefix, upstreamPath });
  }
  return routes;
}

function parseLoaderPaths() {
  const src = read("apps/web/src/app/_data/loaders.ts");
  return [...src.matchAll(/fetchJson\("([^"]+)"/g)].map((m) => m[1]);
}

function parseCiJobs() {
  const ci = read(".github/workflows/ci.yml");
  const jobs = [...ci.matchAll(/^\s{2}([\w-]+):\s*$/gm)].map((m) => m[1]);
  return jobs.filter((j) => j !== "env" && j !== "on");
}

// ── Testing ───────────────────────────────────────────────────────────────────

function scoreTesting(services) {
  const checks = {};
  const withTests = services.filter((s) => exists(`services/${s}/tests`) || exists(`services/${s}/src`));
  const testFiles = services.filter((s) => {
    const t = join(ROOT, "services", s, "tests");
    if (!existsSync(t)) return false;
    return readdirSync(t).some((f) => f.endsWith(".test.ts"));
  });

  checks.contractTest = exists("tests/contract/gateway.contract.test.ts");
  checks.vitestAtRoot = exists("vitest.config.mjs") && read("package.json").includes('"vitest"');
  checks.e2eSpecs = existsSync(join(ROOT, "apps/web/e2e")) &&
    readdirSync(join(ROOT, "apps/web/e2e")).filter((f) => f.endsWith(".spec.ts")).length >= 5;
  checks.serviceTestRatio = testFiles.length / Math.max(services.length, 1);
  checks.packagesWithTests = ["packages/auth", "packages/db", "packages/schemas", "packages/client-core"]
    .filter((p) => exists(`${p}/package.json`) && read(`${p}/package.json`).includes('"test"')).length >= 3;

  const ciJobs = parseCiJobs();
  checks.ciTestJob = ciJobs.includes("test");
  checks.ciContractJob = ciJobs.includes("contract-tests");
  checks.ciE2eJob = ciJobs.includes("e2e");

  const weights = {
    contractTest: 15,
    vitestAtRoot: 10,
    e2eSpecs: 15,
    serviceTestRatio: 25,
    packagesWithTests: 10,
    ciTestJob: 10,
    ciContractJob: 10,
    ciE2eJob: 5,
  };

  let score = 0;
  score += checks.contractTest ? weights.contractTest : 0;
  score += checks.vitestAtRoot ? weights.vitestAtRoot : 0;
  score += checks.e2eSpecs ? weights.e2eSpecs : 0;
  score += Math.round(checks.serviceTestRatio * weights.serviceTestRatio);
  score += checks.packagesWithTests ? weights.packagesWithTests : 0;
  score += checks.ciTestJob ? weights.ciTestJob : 0;
  score += checks.ciContractJob ? weights.ciContractJob : 0;
  score += checks.ciE2eJob ? weights.ciE2eJob : 0;

  return { score: Math.min(100, score), checks, detail: `${testFiles.length}/${services.length} services have tests` };
}

// ── Security ──────────────────────────────────────────────────────────────────

const SENSITIVE_ROUTE_HINTS = ["users", "sessions", "mfa", "roles", "audit", "api-keys", "breakglass"];

function scoreSecurity(services) {
  const checks = {};
  const domainServices = services.filter((s) => s !== "gateway-service");

  let authRegistered = 0;
  let missingAuth = [];
  for (const svc of domainServices) {
    const appPath = `services/${svc}/src/app.ts`;
    if (!exists(appPath)) continue;
    const app = read(appPath);
    if (app.includes("authPlugin")) authRegistered++;
    else missingAuth.push(svc);
  }
  checks.authOnServices = authRegistered / Math.max(domainServices.length, 1);
  checks.missingAuthServices = missingAuth;

  let sensitiveRoutes = 0;
  let sensitiveWithRole = 0;
  for (const svc of domainServices) {
    const routesDir = join(ROOT, "services", svc, "src");
    if (!existsSync(routesDir)) continue;
    for (const f of walkRoutes(routesDir)) {
      const rel = f.replace(join(ROOT, "services", svc, "src") + "/", "");
      const isSensitive = SENSITIVE_ROUTE_HINTS.some((h) => rel.includes(h));
      if (!isSensitive) continue;
      sensitiveRoutes++;
      const body = readFileSync(f, "utf8");
      if (body.includes("requireRole")) sensitiveWithRole++;
    }
  }
  checks.sensitiveRouteProtection = sensitiveRoutes === 0 ? 1 : sensitiveWithRole / sensitiveRoutes;

  checks.infraEnvNotTracked = !gitTracked("infra/.env");
  const envSample = exists("infra/.env") ? read("infra/.env") : "";
  checks.infraEnvGitignored = exists(".gitignore") && read(".gitignore").includes("infra/.env");
  checks.noDevSecretsInTrackedInfra =
    !gitTracked("infra/.env") ||
    !/(civitas_dev_pw|civitas_kc_dev_pw|password=test)/i.test(envSample);

  const weights = {
    authOnServices: 35,
    sensitiveRouteProtection: 30,
    infraEnvNotTracked: 20,
    infraEnvGitignored: 15,
  };

  let score = 0;
  score += Math.round(checks.authOnServices * weights.authOnServices);
  score += Math.round(checks.sensitiveRouteProtection * weights.sensitiveRouteProtection);
  score += checks.infraEnvNotTracked ? weights.infraEnvNotTracked : 0;
  score += checks.infraEnvGitignored ? weights.infraEnvGitignored : 0;

  return {
    score: Math.min(100, score),
    checks,
    detail: `${authRegistered}/${domainServices.length} services register authPlugin`,
  };
}

// ── API alignment ─────────────────────────────────────────────────────────────

function scoreApiAlignment() {
  const routes = parseRegistry();
  const loaderPaths = parseLoaderPaths();
  const missing = [];
  for (const path of loaderPaths) {
    if (!resolveUpstream(path, routes)) missing.push(path);
  }
  const aligned = loaderPaths.length - missing.length;
  const ratio = loaderPaths.length ? aligned / loaderPaths.length : 1;
  return {
    score: Math.round(ratio * 100),
    checks: { aligned, total: loaderPaths.length, missing },
    detail: `${aligned}/${loaderPaths.length} loader paths resolve via gateway`,
  };
}

// ── Production risk (100 = ready, lower risk) ───────────────────────────────

function scoreProductionRisk(testing, security, apiAlignment) {
  const checks = {};
  const loaders = exists("apps/web/src/app/_data/loaders.ts") ? read("apps/web/src/app/_data/loaders.ts") : "";
  checks.noMockFallback = !loaders.includes("mockData");
  checks.ciWorkflow = exists(".github/workflows/ci.yml");
  checks.releaseGate = exists(".github/workflows/release.yml") &&
    read(".github/workflows/release.yml").includes("qa-readiness-score");
  checks.postgresBootstrap = exists("scripts/ci/bootstrap-postgres.sh");
  checks.packageManager = read("package.json").includes('"packageManager"');

  const ciJobs = parseCiJobs();
  checks.ciCoverage = ["typecheck-lint", "test", "contract-tests", "e2e", "arch-guard", "web-build", "qa-readiness"]
    .filter((j) => ciJobs.includes(j)).length;

  const expectedCiJobs = 7;
  const riskPoints =
    (checks.noMockFallback ? 0 : 15) +
    (!checks.ciWorkflow ? 20 : 0) +
    (!checks.releaseGate ? 15 : 0) +
    (!checks.postgresBootstrap ? 10 : 0) +
    (!checks.packageManager ? 10 : 0) +
    Math.max(0, (expectedCiJobs - checks.ciCoverage) * 5) +
    Math.max(0, 100 - testing.score) * 0.15 +
    Math.max(0, 100 - security.score) * 0.2 +
    Math.max(0, 100 - apiAlignment.score) * 0.15;

  const score = Math.max(0, Math.min(100, Math.round(100 - riskPoints)));

  return { score, checks, detail: `${checks.ciCoverage}/7 core CI jobs present` };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const services = listServices();
const testing = scoreTesting(services);
const security = scoreSecurity(services);
const apiAlignment = scoreApiAlignment();
const productionRisk = scoreProductionRisk(testing, security, apiAlignment);

const overall = Math.round((testing.score + security.score + productionRisk.score) / 3);

const report = {
  overall,
  testing: testing.score,
  security: security.score,
  productionRisk: productionRisk.score,
  apiAlignment: apiAlignment.score,
  QA_READY: overall >= minScore && testing.score >= minScore && security.score >= minScore && productionRisk.score >= minScore,
  details: {
    testing: testing.checks,
    security: { ...security.checks, missingAuthServices: security.checks.missingAuthServices },
    apiAlignment: apiAlignment.checks,
    productionRisk: productionRisk.checks,
  },
};

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("# QA Readiness Score\n");
  console.log("| Dimension | Score |");
  console.log("|-----------|------:|");
  console.log(`| Testing | ${testing.score}/100 |`);
  console.log(`| Security | ${security.score}/100 |`);
  console.log(`| Production readiness (100 = low risk) | ${productionRisk.score}/100 |`);
  console.log(`| API alignment | ${apiAlignment.score}/100 |`);
  console.log(`\n**Overall: ${overall}/100**\n`);
  console.log("## Details");
  console.log(`- Testing: ${testing.detail}`);
  console.log(`- Security: ${security.detail}`);
  console.log(`- API: ${apiAlignment.detail}`);
  console.log(`- Production: ${productionRisk.detail}`);
  if (apiAlignment.checks.missing?.length) {
    console.log("\n### Unmapped loader paths");
    for (const p of apiAlignment.checks.missing) console.log(`- ${p}`);
  }
  if (security.checks.missingAuthServices?.length) {
    console.log("\n### Services missing authPlugin");
    for (const s of security.checks.missingAuthServices) console.log(`- ${s}`);
  }
  console.log(`\nQA_READY: ${report.QA_READY}`);
}

if (minScore > 0 && !report.QA_READY) {
  process.exit(1);
}
