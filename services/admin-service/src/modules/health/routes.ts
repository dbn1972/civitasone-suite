import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { z } from "zod";
import { resolveContext, requireSuperAdmin, requireRole, TENANT_ADMIN_ROLES, HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";
import { computeProductionReadiness } from "./readiness.js";
import { getOperationsSnapshot } from "./operations.js";

const serviceParam = z.object({ service: z.string().min(1) });

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/health", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    return reply.send(await queries.getAggregateHealth());
  });

  // P0-1: readiness exposes platform internals and is restricted to super_admin.
  app.get("/v1/admin/health/readiness", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    return reply.send(computeProductionReadiness());
  });

  app.get("/v1/admin/operations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    return reply.send(await getOperationsSnapshot());
  });

  app.get("/v1/admin/health/:service", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { service } = serviceParam.parse(req.params);
    const result = await queries.getServiceHealth(service);
    if (!result) throw new HttpError(404, "NOT_FOUND", "service not in registry");
    return reply.send(result);
  });

  app.get("/v1/admin/queue-metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    // Return queue metrics from env/config — actual SQS metrics come from CloudWatch/Prometheus
    return reply.send({
      driver: process.env.QUEUE_DRIVER ?? "memory",
      visibilityTimeout: Number(process.env.SQS_VISIBILITY_TIMEOUT ?? 60),
      metrics: {
        note: "Real-time queue depth available at /metrics (Prometheus scrape) and Grafana dashboards",
        prometheusEndpoint: "/metrics",
        grafanaDashboard: "/grafana/d/queue-overview",
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
