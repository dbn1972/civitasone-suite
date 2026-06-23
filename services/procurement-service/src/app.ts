import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { indentRoutes }   from "./modules/indent/routes.js";
import { vendorRoutes }   from "./modules/vendor/routes.js";
import { poRoutes }       from "./modules/po/routes.js";
import { grnRoutes }      from "./modules/grn/routes.js";
import { auctionRoutes }  from "./modules/auction/routes.js";
import { paymentsRoutes } from "./modules/payments/routes.js";
import { approvalsRoutes } from "./modules/approvals/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { rfqRoutes }      from "./modules/rfq/routes.js";
import { tenderRoutes }   from "./modules/tender/routes.js";
import { threeWayMatchRoutes } from "./modules/three-way-match/routes.js";
import { vendorBlacklistRoutes } from "./modules/vendor-blacklist/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "procurement-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(indentRoutes);
  await app.register(vendorRoutes);
  await app.register(poRoutes);
  await app.register(grnRoutes);
  await app.register(auctionRoutes);
  await app.register(paymentsRoutes);
  await app.register(approvalsRoutes);
  await app.register(dashboardRoutes);
  await app.register(rfqRoutes);
  await app.register(tenderRoutes);
  await app.register(threeWayMatchRoutes);
  await app.register(vendorBlacklistRoutes);
  await app.register((await import("./modules/po-print/routes.js")).poPrintRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
