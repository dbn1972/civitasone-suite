import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { maintenancePlanBody, workOrderBody, completeWorkOrderBody, idParam } from "./validators.js";
import * as commands from "./commands.js";

const ASSET_ROLES = ["asset_manager", "asset_admin", "super_admin"];

export async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/assets/:id/maintenance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = idParam.parse(req.params);
    const body = maintenancePlanBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createMaintenancePlan(ctx, id, body));
  });

  app.post("/v1/assets/work-orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = workOrderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createWorkOrder(ctx, body));
  });

  app.patch("/v1/assets/work-orders/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeWorkOrderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeWorkOrder(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
