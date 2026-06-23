import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
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

  registerOpsRoutes(app, { service: "finance-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(budgetRoutes);
  await app.register(glRoutes);
  await app.register(treasuryRoutes);
  await app.register(paymentsRoutes);
  await app.register(dashboardRoutes);
  await app.register(periodCloseRoutes);
  await app.register(reportsRoutes);
  await app.register(bankReconRoutes);
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

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
