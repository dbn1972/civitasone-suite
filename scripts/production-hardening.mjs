#!/usr/bin/env node
/**
 * Production hardening: ops routes, ports, list-cache, accepted validation.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SERVICES = join(ROOT, "services");

const PORT_FIXES = {
  "asset-service/src/index.ts": [/PORT \?\? 3010/, "PORT ?? 3015"],
  "project-service/src/index.ts": [/PORT \?\? 3011/, "PORT ?? 3014"],
  "crm-service/src/index.ts": [/PORT \?\? 3013/, "PORT ?? 3024"],
  "inventory-service/src/index.ts": [/PORT \?\? 3009/, "PORT ?? 3025"],
  "telephony-service/src/index.ts": [/PORT \?\? 3015/, "PORT ?? 3026"],
  "helpdesk-service/src/index.ts": [/PORT \?\? 3014/, "PORT ?? 3027"],
};

for (const [rel, [re, repl]] of Object.entries(PORT_FIXES)) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) continue;
  let s = readFileSync(p, "utf8");
  if (re.test(s)) {
    s = s.replace(re, repl);
    writeFileSync(p, s);
    console.log(`port: ${rel}`);
  }
}

const DOMAIN_SERVICES = readdirSync(SERVICES).filter((d) => {
  try { return statSync(join(SERVICES, d, "src", "app.ts")).isFile(); } catch { return false; }
});

const OPS_BLOCK = /  app\.get\("\/health"[^\n]*\n(?:  app\.get\("\/ready"[^\n]*\n)?(?:  app\.get\("\/metrics"[^\n]*\n)?/;

for (const svc of DOMAIN_SERVICES) {
  const pkgPath = join(SERVICES, svc, "package.json");
  const appPath = join(SERVICES, svc, "src", "app.ts");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.dependencies ??= {};
  if (!pkg.dependencies["@civitasone/observability"]) {
    pkg.dependencies["@civitasone/observability"] = "workspace:*";
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`+ observability dep: ${svc}`);
  }

  let app = readFileSync(appPath, "utf8");
  if (!app.includes("registerOpsRoutes")) {
    if (!app.includes("@civitasone/observability")) {
      const hasInfra = existsSync(join(SERVICES, svc, "src", "shared", "infra.ts"));
      const hasDb = existsSync(join(SERVICES, svc, "src", "shared", "db.ts"));
      let opsImport = `import { registerOpsRoutes, dbPing } from "@civitasone/observability";\n`;
      if (hasInfra) opsImport += `import { cache, queue } from "./shared/infra.js";\n`;
      if (hasDb) opsImport += `import { sqlClient } from "./shared/db.js";\n`;
      app = app.replace(/(import Fastify[^\n]+\n)/, `$1${opsImport}`);
    }

    const serviceName = pkg.name?.replace("@civitasone/", "") ?? svc;
    const checks = [];
    if (existsSync(join(SERVICES, svc, "src", "shared", "db.ts"))) checks.push("db: { ping: () => dbPing(sqlClient) }");
    if (existsSync(join(SERVICES, svc, "src", "shared", "infra.ts"))) {
      checks.push("cache");
      checks.push("queue");
    }
    const checksObj = checks.length
      ? `checks: { ${checks.join(", ")} }`
      : "";
    const opsCall = `  registerOpsRoutes(app, { service: "${serviceName}"${checksObj ? `, ${checksObj}` : ""} });\n\n`;

    if (OPS_BLOCK.test(app)) {
      app = app.replace(OPS_BLOCK, opsCall);
    } else if (!app.includes('app.get("/health"')) {
      app = app.replace(/(await app\.register\(cors[^\n]+\n\n)/, `$1${opsCall}`);
    }
    writeFileSync(appPath, app);
    console.log(`+ ops routes: ${svc}`);
  }
}

// List query cache patches
const LIST_CACHE = [
  {
    file: "finance-service/src/modules/payments/queries.ts",
    old: `export async function listPayments(tenantId: string, limit: number, offset: number): Promise<{ data: PaymentSummary[]; pagination: { hasMore: boolean; pageSize: number } }> {
  const rows = await repo.listPaymentsByTenant(tenantId, limit, offset);
  return {
    data: rows.map((r) => ({
      id: r.id,
      referenceId: r.eftRef ?? r.id,
      beneficiary: \`Bill \${r.billId.slice(0, 8)}\`,
      amountDisplay: formatMinor(r.amountMinor),
      status: mapPaymentStatus(r.status),
    })),
    pagination: { hasMore: rows.length === limit, pageSize: limit },
  };
}`,
    new: `export async function listPayments(tenantId: string, limit: number, offset: number): Promise<{ data: PaymentSummary[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, "payment", \`list:\${limit}:\${offset}\`, async () => {
    const rows = await repo.listPaymentsByTenant(tenantId, limit, offset);
    return {
      data: rows.map((r) => ({
        id: r.id,
        referenceId: r.eftRef ?? r.id,
        beneficiary: \`Bill \${r.billId.slice(0, 8)}\`,
        amountDisplay: formatMinor(r.amountMinor),
        status: mapPaymentStatus(r.status),
      })),
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        cursor: rows.length ? String(offset + rows.length) : undefined,
      },
    };
  });
}`,
  },
  {
    file: "citizen-service/src/modules/helpdesk/queries.ts",
    old: `export async function listTickets(tenantId: string, limit: number): Promise<{ data: TicketSummary[]; pagination: { hasMore: boolean; pageSize: number } }> {
  const rows = await repo.listTicketsByTenant(tenantId, undefined, limit);`,
    new: `export async function listTickets(tenantId: string, limit: number): Promise<{ data: TicketSummary[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, "ticket", \`list:\${limit}\`, async () => {
  const rows = await repo.listTicketsByTenant(tenantId, undefined, limit);`,
  },
];

for (const patch of LIST_CACHE) {
  const p = join(SERVICES, patch.file);
  if (!existsSync(p)) continue;
  let s = readFileSync(p, "utf8");
  if (patch.old && s.includes(patch.old.split("\n")[0]) && !s.includes("cache.listOrLoad")) {
    s = s.replace(patch.old, patch.new);
    if (patch.file.includes("helpdesk") && !s.includes("});")) {
      s = s.replace(
        /pagination: \{ hasMore: rows\.length === limit, pageSize: limit \},\n  \};\n\}/,
        `pagination: { hasMore: rows.length === limit, pageSize: limit, cursor: rows.length ? rows[rows.length - 1]!.id : undefined },\n    };\n  });\n}`,
      );
    }
    writeFileSync(p, s);
    console.log(`+ list cache: ${patch.file}`);
  }
}

console.log("Production hardening pass complete.");
