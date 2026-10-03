/**
 * items HTTP routes — item master + categories + units of measure + substitutes
 * + bins/rack + reservations + goods returns/QC.
 * Reads are tenant-scoped; writes are role-gated and run through the queue.
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, registerErrorHandler, HttpError } from "../../shared/context.js";
import {
  createItemBody, updateItemBody, createCategoryBody, createUomBody,
  patchCategoryBody, patchUomBody,
  createSubstituteBody, createBinBody, createReservationBody, releaseReservationBody,
  createGoodsReturnBody, qcInspectionBody, binStatusBody, updateSettingsBody,
  itemQueryParams, idParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { resolveUserNames } from "../../shared/identity-client.js";

const WRITE_ROLES  = ["inventory_user", "inventory_manager", "inventory_admin", "store_keeper", "super_admin"];
const READER_ROLES = [...WRITE_ROLES, "audit_officer", "finance_officer"];
const BIN_ADMIN_ROLES = ["inventory_manager", "inventory_admin", "super_admin"];
const SETTINGS_ROLES  = ["inventory_admin", "super_admin"];
const QC_ROLES     = ["inventory_manager", "inventory_admin", "qc_inspector", "super_admin"];

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  // ── Items ──────────────────────────────────────────────────────────────
  app.post("/v1/inventory/items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createItemBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createItem(ctx, body));
  });

  app.patch("/v1/inventory/items/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateItemBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateItem(ctx, id, body));
  });

  app.get("/v1/inventory/items/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const item = await queries.getItem(ctx.tenantId, id);
    if (!item) throw new HttpError(404, "NOT_FOUND", "item not found");
    return reply.send(item);
  });

  app.get("/v1/inventory/items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = itemQueryParams.parse(req.query);
    const opts: { categoryId?: string; status?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.categoryId !== undefined) opts.categoryId = q.categoryId;
    if (q.status !== undefined) opts.status = q.status;
    return reply.send(await queries.listItems(ctx.tenantId, opts));
  });

  // ── Categories ────────────────────────────────────────────────────────
  app.post("/v1/inventory/categories", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createCategoryBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCategory(ctx, body));
  });

  app.get("/v1/inventory/categories", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = itemQueryParams.parse(req.query);
    return reply.send({ data: await queries.listCategories(ctx.tenantId, q.limit, q.offset) });
  });
  // ── Categories PATCH ──────────────────────────────────────────────────
  app.patch("/v1/inventory/categories/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = patchCategoryBody.parse(req.body);
    const existing = await repo.findCategory(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "category not found");
    const patch: { name?: string; code?: string; parentId?: string | null } = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.code !== undefined) patch.code = body.code;
    if (body.parentId !== undefined) patch.parentId = body.parentId;
    const updated = await repo.updateCategory(id, ctx.tenantId, patch, ctx.actorId);
    return reply.send(updated);
  });


  // ── Units of measure ─────────────────────────────────────────────────────
  app.post("/v1/inventory/uoms", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createUomBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createUom(ctx, body));
  });

  app.get("/v1/inventory/uoms", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = itemQueryParams.parse(req.query);
    return reply.send({ data: await queries.listUoms(ctx.tenantId, q.limit, q.offset) });
  });
  // ── Units of measure PATCH ──────────────────────────────────────────────
  app.patch("/v1/inventory/uoms/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = patchUomBody.parse(req.body);
    const existing = await repo.findUom(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "uom not found");
    const patch: { name?: string; symbol?: string } = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.symbol !== undefined) patch.symbol = body.symbol;
    const updated = await repo.updateUom(id, ctx.tenantId, patch, ctx.actorId);
    return reply.send(updated);
  });


  // ── Substitutes (SVC-051) ─────────────────────────────────────────────
  app.post("/v1/inventory/substitutes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createSubstituteBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createSubstitute(ctx, body));
  });

  app.get("/v1/inventory/items/:id/substitutes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: await queries.listSubstitutes(ctx.tenantId, id) });
  });

  // Bulk substitutes: one tenant-scoped, ordered, paged read so the register need not fan out
  // one GET per item (GAP-INVENTORY-SUBSTITUTES-04).
  app.get("/v1/inventory/substitutes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = itemQueryParams.parse(req.query);
    const rows = await queries.listAllSubstitutes(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows, pagination: { hasMore: rows.length === q.limit, pageSize: q.limit } });
  });

  // ── Bins/Rack (SVC-052) ───────────────────────────────────────────────
  app.post("/v1/inventory/bins", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createBinBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createBin(ctx, body));
  });

  app.get("/v1/inventory/bins", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = itemQueryParams.parse(req.query);
    return reply.send({ data: await queries.listBins(ctx.tenantId, q.limit, q.offset) });
  });

  app.patch("/v1/inventory/bins/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BIN_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = binStatusBody.parse(req.body);
    // Synchronous pre-checks so a missing / already-in-that-state bin is a real answer, not a dropped 202.
    // The consumer re-enforces the transition atomically (UPDATE ... WHERE is_active = <opposite>).
    const bin = await repo.findBin(ctx.tenantId, id);
    if (!bin) throw new HttpError(404, "NOT_FOUND", "bin not found");
    if (bin.isActive === body.isActive) {
      throw new HttpError(409, "NO_CHANGE", `bin is already ${bin.isActive ? "active" : "inactive"}`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.setBinStatus(ctx, id, body));
  });

  // ── Tenant inventory policy ───────────────────────────────────────────
  app.get("/v1/inventory/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send({ data: await queries.getSettings(ctx.tenantId) });
  });

  app.put("/v1/inventory/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SETTINGS_ROLES);
    const body = updateSettingsBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateSettings(ctx, body));
  });

  // ── Reservations (SVC-054) ────────────────────────────────────────────
  app.post("/v1/inventory/reservations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createReservationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createReservation(ctx, body));
  });

  app.patch("/v1/inventory/reservations/:id/release", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = releaseReservationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.releaseReservation(ctx, id, body));
  });

  app.get("/v1/inventory/reservations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = itemQueryParams.parse(req.query);
    return reply.send({ data: await queries.listReservations(ctx.tenantId, q.limit, q.offset) });
  });

  // ── Goods Returns + QC Gate (SVC-053) ─────────────────────────────────
  app.post("/v1/inventory/goods-returns", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createGoodsReturnBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createGoodsReturn(ctx, body));
  });

  app.patch("/v1/inventory/goods-returns/:id/inspect", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, QC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = qcInspectionBody.parse(req.body);
    // Synchronous pre-checks (same pattern as cycle-count approve): without them a
    // missing or already-inspected return got a 202 the consumer then silently
    // dropped. The consumer still enforces pending-only atomically (race safety).
    const record = await queries.getGoodsReturn(ctx.tenantId, id);
    if (!record) throw new HttpError(404, "NOT_FOUND", "goods return not found");
    if (record.qcStatus !== "pending") {
      throw new HttpError(409, "NOT_PENDING", `goods return is already ${record.qcStatus}`);
    }
    // Maker != checker (per-tenant setting, default ON): whoever recorded the return cannot
    // record its QC verdict, for any role. The consumer re-enforces this inside its guarded UPDATE.
    if (record.createdBy === ctx.actorId && (await queries.getSettings(ctx.tenantId)).qcMakerChecker) {
      throw new HttpError(403, "MAKER_CHECKER", "the user who recorded a goods return cannot record its QC verdict");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.inspectGoodsReturn(ctx, id, body));
  });

  app.get("/v1/inventory/goods-returns/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const record = await queries.getGoodsReturn(ctx.tenantId, id);
    if (!record) throw new HttpError(404, "NOT_FOUND", "goods return not found");
    // Display names for the audit trail (best-effort; absent when identity-service cannot name them).
    const names = await resolveUserNames(ctx.tenantId, [record.createdBy, record.qcInspectedBy]);
    return reply.send({
      data: {
        ...record,
        createdByName: names.get(record.createdBy) ?? null,
        qcInspectedByName: record.qcInspectedBy ? names.get(record.qcInspectedBy) ?? null : null,
      },
    });
  });

  app.get("/v1/inventory/goods-returns", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = itemQueryParams.parse(req.query);
    return reply.send({ data: await queries.listGoodsReturns(ctx.tenantId, q.limit, q.offset) });
  });

  registerErrorHandler(app);
}
