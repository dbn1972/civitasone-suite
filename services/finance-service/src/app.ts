import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { budgetRoutes }   from "./modules/budget/routes.js";
import { glRoutes }       from "./modules/gl/routes.js";
import { treasuryRoutes } from "./modules/treasury/routes.js";
import { paymentsRoutes } from "./modules/payments/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { periodCloseRoutes } from "./modules/period-close/routes.js";
import { reportsRoutes } from "./modules/reports/routes.js";
import { bankReconRoutes } from "./modules/bank-recon/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  // G2: RLS enforcement — set app.tenant_id GUC per request so RLS policies
  // enforce tenant isolation even if app-layer WHERE is accidentally omitted.
  app.addHook("onRequest", createTenantTxHook(db));

  // Source the RLS tenant from the AUTHENTICATED token (req.ctx, populated by
  // authPlugin's earlier onRequest hook), not the client-supplied x-tenant-id
  // header. createTenantTxHook only enters AsyncLocalStorage when x-tenant-id is
  // present; token-based requests omit it, so without this the app.tenant_id GUC
  // stays unset and -- under FORCE ROW LEVEL SECURITY -- the fail-closed policy
  // returns zero rows on reads. Sourcing tenantId from the verified token here
  // makes scopedRead()'s transaction set the GUC so RLS enforces isolation.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  registerOpsRoutes(app, { service: "finance-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(budgetRoutes);
  await app.register(glRoutes);
  await app.register(treasuryRoutes);
  await app.register(paymentsRoutes);
  await app.register(dashboardRoutes);
  await app.register(periodCloseRoutes);
  await app.register(reportsRoutes);
  await app.register(bankReconRoutes);
  const { budgetAllocationRoutes } = await import("./modules/budget/allocation-routes.js");
  await app.register(budgetAllocationRoutes);
  const { budgetOutcomeRoutes } = await import("./modules/budget/outcome-routes.js");
  await app.register(budgetOutcomeRoutes);
  const { budgetFormulationRoutes } = await import("./modules/budget/formulation-routes.js");
  await app.register(budgetFormulationRoutes);
  const { pfmsRoutes } = await import("./modules/pfms/routes.js");
  await app.register(pfmsRoutes);
  const { voucherPrintRoutes } = await import("./modules/voucher-print/routes.js");
  await app.register(voucherPrintRoutes);
  const { cashBookRoutes } = await import("./modules/cashbook/routes.js");
  await app.register(cashBookRoutes);
  const { vendorTdsRoutes } = await import("./modules/tds/routes.js");
  await app.register(vendorTdsRoutes);
  const { gstRoutes } = await import("./modules/gst/routes.js");
  await app.register(gstRoutes);
  const { financialStatementsRoutes } = await import("./modules/financial-statements/routes.js");
  await app.register(financialStatementsRoutes);
  const { subLedgerRoutes } = await import("./modules/subledger/routes.js");
  await app.register(subLedgerRoutes);
  const { recurringRoutes } = await import("./modules/recurring/routes.js");
  await app.register(recurringRoutes);
  const { hoaRoutes } = await import("./modules/hoa/routes.js");
  await app.register(hoaRoutes);
  const { mastersRoutes } = await import("./modules/masters/routes.js");
  await app.register(mastersRoutes);
  const { orgStructureRoutes } = await import("./modules/org-structure/routes.js");
  await app.register(orgStructureRoutes);
  const { fyRoutes } = await import("./modules/masters/fy-routes.js");
  await app.register(fyRoutes);
  const { bankRoutes } = await import("./modules/masters/bank-routes.js");
  await app.register(bankRoutes);
  const { instrumentRoutes } = await import("./modules/instruments/routes.js");
  await app.register(instrumentRoutes);
  const { fixedAssetRoutes } = await import("./modules/fixed-asset/routes.js");
  await app.register(fixedAssetRoutes);
  const { pfmsTreasuryStubRoutes } = await import("./modules/pfms/treasury-stubs.js");
  await app.register(pfmsTreasuryStubRoutes);
  const { pfmsAdapterRoutes } = await import("./modules/pfms/adapter-routes.js");
  await app.register(pfmsAdapterRoutes);
  const { simplifiedRoutes } = await import("./modules/simplified/routes.js");
  await app.register(simplifiedRoutes);
  const { tracesRoutes } = await import("./modules/traces/routes.js");
  await app.register(tracesRoutes);
  const { anomalyRoutes } = await import("./modules/anomaly/routes.js");
  await app.register(anomalyRoutes);
  const { resolutionIntakeRoutes } = await import("./modules/resolution-intake/routes.js");
  await app.register(resolutionIntakeRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
