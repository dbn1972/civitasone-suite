import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { payrollRoutes } from "./modules/payroll/routes.js";
import { loansRoutes }   from "./modules/loans/routes.js";
import { statutoryRoutes } from "./modules/statutory/routes.js";
import { ecrRoutes } from "./modules/statutory/ecr-routes.js";
import { payslipPdfRoutes } from "./modules/payslip-pdf/routes.js";
import { payslipDownloadRoutes } from "./modules/payslip-pdf/pdf-route.js";
import { taxRoutes } from "./modules/tax/routes.js";
import { statutoryReturnsRoutes } from "./modules/statutory-returns/routes.js";
import { challanRoutes } from "./modules/statutory-returns/challan-routes.js";
import { loadTaxConfig } from "./modules/tax/config.js";
import { bankTransferRoutes } from "./modules/bank-transfer/routes.js";

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

  registerOpsRoutes(app, { service: "payroll-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await loadTaxConfig();

  await app.register(payrollRoutes);
  await app.register(loansRoutes);
  await app.register(statutoryRoutes);
  await app.register(ecrRoutes);
  await app.register(payslipPdfRoutes);
  await app.register(payslipDownloadRoutes);
  await app.register(taxRoutes);
  await app.register(statutoryReturnsRoutes);
  await app.register(challanRoutes);
  await app.register(bankTransferRoutes);
  const { worldClassPayrollRoutes } = await import("./modules/payroll/world-class-routes.js");
  await app.register(worldClassPayrollRoutes);
  await app.register((await import("./modules/form16-pdf/routes.js")).form16PdfRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
