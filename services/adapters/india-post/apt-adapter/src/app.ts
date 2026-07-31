import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes } from "@civitasone/observability";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { serviceabilityRoutes } from "./modules/serviceability/routes.js";
import { trackingRoutes } from "./modules/tracking/routes.js";
import { bookingRoutes } from "./modules/booking/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "apt-adapter", checks: {} });

  await app.register(serviceabilityRoutes);
  await app.register(trackingRoutes);
  await app.register(bookingRoutes);

  app.setErrorHandler((error, _req, reply) => {
    if (error.validation) {
      return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: error.message } });
    }
    reply.log.error(error);
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "unexpected error" } });
  });

  return app;
}
