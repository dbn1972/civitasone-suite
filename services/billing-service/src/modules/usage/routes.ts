import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireSuperAdmin, HttpError } from "../../shared/context.js";
import { recordUsageBody, tenantParam, usageQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

export async function usageRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/billing/usage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const body = recordUsageBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordUsage(ctx, body.tenantId, body.metricKey, body.quantity));
  });

  app.get("/v1/billing/tenants/:id/usage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = tenantParam.parse(req.params);
    const { month } = usageQuery.parse(req.query);
    return reply.send(await queries.getUsage(id, month));
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
