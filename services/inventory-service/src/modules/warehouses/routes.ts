/**
 * warehouses module — HTTP routes for the canonical warehouse model.
 * Replaces the stock-service warehouse endpoints as part of unification (Req 14.1).
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, registerErrorHandler, HttpError } from "../../shared/context.js";
import { createWarehouseBody, updateWarehouseBody, warehouseQueryParams, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const WRITE_ROLES  = ["inventory_manager", "inventory_admin", "stock_manager", "stock_admin", "super_admin"];
const READER_ROLES = [...WRITE_ROLES, "inventory_user", "store_keeper", "audit_officer", "finance_officer"];

export async function warehouseRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/inventory/warehouses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createWarehouseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createWarehouse(ctx, body));
  });

  app.patch("/v1/inventory/warehouses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateWarehouseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateWarehouse(ctx, id, body));
  });

  app.get("/v1/inventory/warehouses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const wh = await queries.getWarehouse(ctx.tenantId, id);
    if (!wh) throw new HttpError(404, "NOT_FOUND", "warehouse not found");
    return reply.send({ data: wh });
  });

  app.get("/v1/inventory/warehouses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = warehouseQueryParams.parse(req.query);
    const rows = await queries.listWarehouses(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows });
  });

  registerErrorHandler(app);
}
