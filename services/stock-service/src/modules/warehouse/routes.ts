import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createWarehouseBody, warehouseQueryParams } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const STOCK_ROLES = ["stock_manager", "stock_admin", "super_admin"];
// Same reader set as the item/ledger reads: whoever may post an entry must be able to pick a warehouse.
const READER_ROLES = [...STOCK_ROLES, "procurement_officer", "audit_officer", "finance_officer"];

export async function warehouseRoutes(app: FastifyInstance): Promise<void> {
  // GAP-STOCK-LEDGER-NEW-01: warehouse list for the entry form pickers (transfers need a from/to pair).
  app.get("/v1/stock/warehouses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = warehouseQueryParams.parse(req.query);
    const opts: repo.WarehouseListOpts = { activeOnly: q.activeOnly, limit: q.limit, offset: q.offset };
    if (q.q !== undefined) opts.q = q.q;
    const rows = await repo.findWarehousesByTenant(ctx.tenantId, opts);
    return reply.send({
      data: rows.map((w) => ({ id: w.id, name: w.name, code: w.code, address: w.address, isActive: w.isActive })),
      limit: q.limit,
      offset: q.offset,
    });
  });

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
