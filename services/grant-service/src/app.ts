import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { schemeRoutes }        from "./modules/scheme/routes.js";
import { applicationRoutes }   from "./modules/application/routes.js";
import { disbursementRoutes }  from "./modules/disbursement/routes.js";
import { utilisationRoutes }   from "./modules/utilisation/routes.js";
import { beneficiaryRoutes }   from "./modules/beneficiary/routes.js";
import { dashboardRoutes }     from "./modules/dashboard/routes.js";
import { ucValidationRoutes }  from "./modules/uc-validation/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "grant-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });


  await app.register(schemeRoutes);
  await app.register(applicationRoutes);
  await app.register(disbursementRoutes);
  await app.register(utilisationRoutes);
  await app.register(beneficiaryRoutes);
  await app.register(dashboardRoutes);
  await app.register(ucValidationRoutes);

  registerSchemaErrorHandler(app, HttpError);

  return app;
}
