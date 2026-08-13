/**
 * consumables routes — inventory management for stationery, office supplies, materials.
 *
 * GET  /v1/estab/consumables                       — list items
 * POST /v1/estab/consumables                       — create new consumable item
 * GET  /v1/estab/consumables/:id                   — get item detail
 * POST /v1/estab/consumables/:id/transactions      — record stock movement
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";
import * as commands from "./commands.js";

const ROLES   = ["estab_officer", "estab_admin", "store_officer", "super_admin"];
const READERS = [...ROLES, "audit_officer", "section_officer"];

const idParam = z.object({ id: z.string().uuid() });

const createBody = z.object({
  name:         z.string().min(1).max(256),
  category:     z.string().max(64).optional(),
  unit:         z.string().max(32).optional(),
  reorderLevel: z.number().nonnegative().optional(),
});

const txnBody = z.object({
  txnType: z.enum(["receipt", "issue", "adjustment", "return"]),
  qty:     z.number().refine((n) => n !== 0, "qty must be non-zero"),
  refDoc:  z.string().max(256).optional(),
  notes:   z.string().max(1024).optional(),
});

const listQuery = z.object({
  category: z.string().optional(),
  search:   z.string().optional(),
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});

export async function consumablesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/estab/consumables", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READERS);
    const q = listQuery.parse(req.query);
    const data = await queries.listConsumables(ctx.tenantId, {
      category: q.category ?? undefined,
      search:   q.search   ?? undefined,
      limit:    q.pageSize,
      offset:   (q.page - 1) * q.pageSize,
    });
    return reply.send({ data, page: q.page, pageSize: q.pageSize });
  });

  app.post("/v1/estab/consumables", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createBody.parse(req.body);
    const result = await commands.createConsumable(ctx, {
      name:         body.name,
      category:     body.category ?? undefined,
      unit:         body.unit     ?? undefined,
      reorderLevel: body.reorderLevel ?? undefined,
    });
    return reply.code(202).send({ data: result });
  });

  app.get("/v1/estab/consumables/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READERS);
    const { id } = idParam.parse(req.params);
    const item = await queries.getConsumableById(ctx.tenantId, id);
    if (!item) throw new HttpError(404, "NOT_FOUND", "consumable item not found");
    return reply.send({ data: item });
  });

  app.post("/v1/estab/consumables/:id/transactions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = txnBody.parse(req.body);
    const result = await commands.recordTransaction(ctx, {
      itemId:  id,
      txnType: body.txnType,
      qty:     body.qty,
      refDoc:  body.refDoc  ?? undefined,
      notes:   body.notes   ?? undefined,
    });
    return reply.code(202).send({ data: result });
  });
}
