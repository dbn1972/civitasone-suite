import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { registerRateLimit } from "@civitasone/rate-limit";
import { globalRateLimit, rateLimitAllowList, rateLimitKey } from "./shared/rate-limit.js";
import { randomUUID } from "node:crypto";
import { fileRoutes }    from "./modules/files/routes.js";
import { folderRoutes }  from "./modules/folders/routes.js";
import { workflowRoutes } from "./modules/workflow/routes.js";
import { sharingRoutes } from "./modules/sharing/routes.js";
import { bulkScanRoutes } from "./modules/bulk-scan/routes.js";
import { bulkScanSettingsRoutes } from "./modules/bulk-scan/settings-routes.js";
import { reviewRoutes } from "./modules/bulk-scan/review-routes.js";
import { linksRoutes } from "./modules/bulk-scan/links-routes.js";
import { filedDocumentRoutes } from "./modules/bulk-scan/files-routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);
  // Per tenant + authenticated user (auth runs first so the key sees the verified identity); the download / page-image routes carry stricter route limits.
  // allowList defaults to [] (never the plugin's loopback default): the gateway proxies from 127.0.0.1, so exempting loopback would switch limiting off.
  await registerRateLimit(app, { max: globalRateLimit(), timeWindow: "1 minute", keyGenerator: rateLimitKey, allowList: rateLimitAllowList() });

  app.addHook("onRequest", createTenantTxHook(db));

  registerOpsRoutes(app, { service: "document-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(fileRoutes);
  await app.register(folderRoutes);
  await app.register(workflowRoutes);
  await app.register(sharingRoutes);
  await app.register(bulkScanRoutes);
  await app.register(bulkScanSettingsRoutes);
  await app.register(reviewRoutes);
  await app.register(linksRoutes);
  await app.register(filedDocumentRoutes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
