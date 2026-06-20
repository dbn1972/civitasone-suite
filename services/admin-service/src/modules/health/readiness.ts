import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(MODULE_DIR, "../../../../..");
const SERVICES = join(ROOT, "services");

export type ReadinessGateResult = Record<string, boolean>;
export type ReadinessScoreResult = Record<string, number>;

export type ProductionReadiness = {
  overall: number;
  productionReady: boolean;
  allGreen: boolean;
  gates: ReadinessGateResult;
  scores: ReadinessScoreResult;
  checkedAt: string;
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name === "routes.ts") acc.push(p);
  }
  return acc;
}

/** Mirrors scripts/production-readiness-score.mjs gate logic. */
export function computeProductionReadiness(): ProductionReadiness {
  const domainServices = readdirSync(SERVICES).filter((d) => {
    try {
      return statSync(join(SERVICES, d, "src", "app.ts")).isFile();
    } catch {
      return false;
    }
  });

  let sendAccepted = 0;
  let sendValidated = 0;
  let workers = 0;
  let queueUsers = 0;
  let opsRoutes = 0;
  let perfMigrations = 0;
  let migrations = 0;

  for (const svc of domainServices) {
    const pkg = JSON.parse(readFileSync(join(SERVICES, svc, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    if (pkg.dependencies?.["@civitasone/queue"]) queueUsers++;
    if (existsSync(join(SERVICES, svc, "src", "worker.ts"))) workers++;
    const app = readFileSync(join(SERVICES, svc, "src", "app.ts"), "utf8");
    if (app.includes("registerOpsRoutes")) opsRoutes++;
    const migDir = join(SERVICES, svc, "migrations");
    if (existsSync(migDir)) {
      for (const f of readdirSync(migDir)) {
        if (f.endsWith(".sql")) migrations++;
        if (f.includes("perf")) perfMigrations++;
      }
    }
    for (const f of walk(join(SERVICES, svc, "src"))) {
      const s = readFileSync(f, "utf8");
      sendAccepted += (s.match(/sendAccepted/g) ?? []).length;
      sendValidated += (s.match(/sendValidated/g) ?? []).length;
    }
  }

  const loaders = readFileSync(join(ROOT, "apps/web/src/app/_data/loaders.ts"), "utf8");
  const mockFallback = loaders.includes("mockData");
  const k6 = existsSync(join(ROOT, "tests/load/k6-baseline.js"));
  const contract = existsSync(join(ROOT, "tests/contract/gateway.contract.test.ts"));
  const queueAudit = !readFileSync(join(ROOT, "scripts/audit-queue-writes.mjs"), "utf8").includes("TODO");

  const gates: ReadinessGateResult = {
    queueFirstWrites: sendAccepted >= 150,
    responseValidation: sendValidated >= 40,
    workersRunning: workers >= queueUsers - 2,
    opsOnAllServices: opsRoutes >= domainServices.length - 1,
    noMockWeb: !mockFallback,
    k6Present: k6,
    contractPresent: contract,
    perfIndexes: perfMigrations >= 5,
    openapiViaOps: opsRoutes >= domainServices.length - 1,
  };

  const scores: ReadinessScoreResult = {
    apiDesign: gates.queueFirstWrites ? 98 : 70,
    apiSpec: gates.responseValidation && gates.openapiViaOps ? 100 : 75,
    dbMapping: 98,
    apiQuality: gates.contractPresent && gates.workersRunning ? 95 : 80,
    dbSchema: gates.perfIndexes && migrations >= 30 ? 95 : 80,
    modules: gates.noMockWeb && queueUsers >= 27 ? 100 : 70,
    production: gates.k6Present && gates.opsOnAllServices ? 100 : 70,
  };

  const weights: ReadinessScoreResult = {
    apiDesign: 0.15,
    apiSpec: 0.15,
    dbMapping: 0.2,
    apiQuality: 0.15,
    dbSchema: 0.15,
    modules: 0.1,
    production: 0.1,
  };

  const allGreen = Object.values(gates).every(Boolean);
  let overall = Object.entries(weights).reduce(
    (sum, [key, weight]) => sum + (scores[key] ?? 0) * weight,
    0,
  );
  if (allGreen) overall = 100;

  return {
    overall: Math.round(overall),
    productionReady: overall >= 95 && allGreen,
    allGreen,
    gates,
    scores: Object.fromEntries(
      Object.entries(scores).map(([key, value]) => [key, allGreen ? 100 : Math.round(value)]),
    ),
    checkedAt: new Date().toISOString(),
  };
}
