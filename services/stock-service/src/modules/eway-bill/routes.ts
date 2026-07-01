import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createEwayBillBody, cancelEwayBillBody, updateVehicleBody, listQueryParams, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const EWB_ROLES   = ["stock_manager", "stock_admin", "super_admin", "logistics_officer"];
const READER_ROLES = [...EWB_ROLES, "audit_officer", "finance_officer"];

export async function ewayBillRoutes(app: FastifyInstance): Promise<void> {
  // Create e-Way Bill
  app.post("/v1/stock/eway-bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EWB_ROLES);
    const body = createEwayBillBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.generateEwayBill(ctx, body));
  });

  // Cancel e-Way Bill (within 24h)
  app.patch("/v1/stock/eway-bills/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EWB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = cancelEwayBillBody.parse(req.body);

    // Pre-check: bill must exist and be active
    const bill = await repo.findById(ctx.tenantId, id);
    if (!bill) throw new HttpError(404, "NOT_FOUND", "e-Way Bill not found");
    if (bill.status !== "active") throw new HttpError(409, "INVALID_STATE", `cannot cancel bill in '${bill.status}' status`);

    // Check 24h window at route level for fast feedback
    const createdAt = new Date(bill.createdAt).getTime();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    if (Date.now() - createdAt > TWENTY_FOUR_HOURS) {
      throw new HttpError(409, "CANCELLATION_WINDOW_EXPIRED", "e-Way Bill can only be cancelled within 24 hours of generation");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.cancelEwayBill(ctx, id, body));
  });

  // Update vehicle (Part-B)
  app.patch("/v1/stock/eway-bills/:id/update-vehicle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EWB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateVehicleBody.parse(req.body);

    const bill = await repo.findById(ctx.tenantId, id);
    if (!bill) throw new HttpError(404, "NOT_FOUND", "e-Way Bill not found");
    if (bill.status !== "active") throw new HttpError(409, "INVALID_STATE", `cannot update vehicle for bill in '${bill.status}' status`);

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateEwayBillVehicle(ctx, id, body));
  });

  // List e-Way Bills for tenant
  app.get("/v1/stock/eway-bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQueryParams.parse(req.query);
    const rows = await repo.findByTenant(ctx.tenantId, { status: q.status, limit: q.limit, offset: q.offset });
    return reply.send({
      data: rows.map(serializeEwayBill),
      limit: q.limit,
      offset: q.offset,
    });
  });

  // Get e-Way Bill by ID
  app.get("/v1/stock/eway-bills/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const bill = await repo.findById(ctx.tenantId, id);
    if (!bill) throw new HttpError(404, "NOT_FOUND", "e-Way Bill not found");
    return reply.send({ data: serializeEwayBill(bill) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}

function serializeEwayBill(row: any): Record<string, unknown> {
  return {
    ...row,
    totalValueMinor: row.totalValueMinor?.toString?.() ?? row.totalValueMinor,
  };
}
