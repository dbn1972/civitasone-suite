#!/usr/bin/env node
/**
 * Audits domain services for queue-first write compliance.
 * Flags route handlers that write to Postgres directly (CQRS violation).
 *
 * Usage: node scripts/audit-queue-writes.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVICES = join(ROOT, "services");

const NO_WORKER_OK = new Set(["queue-service", "gateway-service", "crm-service", "theme-service"]);

const WRITE_PATTERNS = [
  /\bdb\.transaction\s*\(/,
  /\bdb\.insert\s*\(/,
  /\bdb\.update\s*\(/,
  /\bdb\.delete\s*\(/,
  /await\s+repo\.\w+\([^)]*\)\s*;?\s*$/m,
];

const ALLOWED_ROUTE_EXCEPTIONS = new Set([
  "services/identity-service/src/modules/sync/routes.ts",
  "services/estab-service/src/modules/files/routes.ts",
]);

async function walk(dir, acc = []) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, acc);
    else if (ent.name === "routes.ts") acc.push(p);
  }
  return acc;
}

function rel(path) {
  return relative(ROOT, path).replace(/\\/g, "/");
}

async function main() {
  const services = (await readdir(SERVICES, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const report = {
    queueReady: [],
    missingWorker: [],
    directDbWritesInRoutes: [],
    usesQueuePackage: [],
  };

  for (const svc of services.sort()) {
    const svcRoot = join(SERVICES, svc);
    const hasWorker = await fileExists(join(svcRoot, "src/worker.ts"));
    const hasInfra = await fileExists(join(svcRoot, "src/shared/infra.ts"));
    const pkg = await readFile(join(svcRoot, "package.json"), "utf8").catch(() => "{}");
    const pkgJson = JSON.parse(pkg);
    const usesQueue = Boolean(
      pkgJson.dependencies?.["@civitasone/queue"] ||
      pkgJson.dependencies?.["@civitasone/queue-service"],
    );

    if (usesQueue) report.usesQueuePackage.push(svc);
    if (hasInfra && usesQueue) report.queueReady.push(svc);
    if (usesQueue && !hasWorker && !NO_WORKER_OK.has(svc)) report.missingWorker.push(svc);

    const routes = await walk(join(svcRoot, "src")).catch(() => []);
    for (const routeFile of routes) {
      const r = rel(routeFile);
      if (ALLOWED_ROUTE_EXCEPTIONS.has(r)) continue;
      const src = await readFile(routeFile, "utf8");
      if (!WRITE_PATTERNS.some((re) => re.test(src))) continue;
      if (/\bdb\.(transaction|insert|update|delete)\s*\(/.test(src)) {
        report.directDbWritesInRoutes.push(r);
      }
    }
  }

  console.log("# Queue stitching audit\n");
  console.log(`## Services using @civitasone/queue (${report.usesQueuePackage.length})`);
  console.log(report.usesQueuePackage.map((s) => `- ${s}`).join("\n") || "- none");
  console.log(`\n## Workers present (${report.queueReady.filter((s) => !report.missingWorker.includes(s)).length} of ${report.usesQueuePackage.length})`);
  for (const svc of report.usesQueuePackage) {
    if (NO_WORKER_OK.has(svc)) {
      console.log(`- ${svc}: N/A (bus/edge service)`);
      continue;
    }
    const worker = !(await fileExists(join(SERVICES, svc, "src/worker.ts"))) ? "MISSING worker.ts" : "worker.ts OK";
    console.log(`- ${svc}: ${worker}`);
  }
  console.log("\n## Direct DB writes in routes.ts (violations)");
  if (report.directDbWritesInRoutes.length === 0) {
    console.log("- none (excluding documented sync + estab audit exceptions)");
  } else {
    for (const f of report.directDbWritesInRoutes) console.log(`- ${f}`);
  }
  console.log("\n## Documented exceptions (allowed)");
  for (const f of ALLOWED_ROUTE_EXCEPTIONS) console.log(`- ${f}`);
  console.log("\n## Bus ownership");
  console.log("- Canonical implementation: services/queue-service/src/bus.ts");
  console.log("- Domain import path: @civitasone/queue → @civitasone/queue-service");
  console.log("- Observability HTTP: queue-service :3030 /health /ready /v1/queue/status");
}

async function fileExists(p) {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
