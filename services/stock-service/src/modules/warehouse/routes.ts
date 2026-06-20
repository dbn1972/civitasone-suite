import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createWarehouseBody } from "./validators.js";
import * as commands from "./commands.js";

const STOCK_ROLES = ["stock_manager", "stock_admin", "super_admin"];

export async function warehouseRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/stock/warehouses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STOCK_ROLES);
    const body = createWarehouseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createWarehouse(ctx, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
