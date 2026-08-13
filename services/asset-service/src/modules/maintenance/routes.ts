import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { maintenancePlanBody, workOrderBody, completeWorkOrderBody, idParam, meterReadingBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { z } from "zod";

const ASSET_ROLES  = ["asset_manager", "asset_admin", "super_admin"];
const READER_ROLES = [...ASSET_ROLES, "audit_officer"];

const listQuerySchema = z.object({
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
  // List maintenance work orders (tenant-scoped)
  app.get("/v1/assets/maintenance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await queries.listMaintenance(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  app.get("/v1/assets/assets/:id/maintenance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await queries.listMaintenanceByAsset(ctx.tenantId, id);
    return reply.send({ data: rows });
  });

  // gateway upstreamPath "/v1/assets" + caller "/assets/:id/maintenance" → "/v1/assets/assets/:id/maintenance"
  app.post("/v1/assets/assets/:id/maintenance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = idParam.parse(req.params);
    const body = maintenancePlanBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createMaintenancePlan(ctx, id, body));
  });

  app.post("/v1/assets/assets/:id/meter-readings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = idParam.parse(req.params);
    const body = meterReadingBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createMeterReading(ctx, id, body));
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

  // G17: Maintenance plans list
  app.get("/v1/assets/maintenance/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["asset_manager", "asset_admin", "super_admin"]);
    const q = req.query as { assetId?: string };
    const opts: { assetId?: string } = {};
    if (q.assetId) opts.assetId = q.assetId;
    const rows = await queries.listMaintenancePlans(ctx.tenantId, opts);
    return reply.send({ data: rows });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
