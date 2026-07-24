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
  createSubstituteBody, createBinBody, createReservationBody, releaseReservationBody,
  createGoodsReturnBody, qcInspectionBody,
  itemQueryParams, idParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const WRITE_ROLES  = ["inventory_user", "inventory_manager", "inventory_admin", "store_keeper", "super_admin"];
const READER_ROLES = [...WRITE_ROLES, "audit_officer", "finance_officer"];
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
    return sendAccepted(reply, acceptedResponseSchema, await commands.inspectGoodsReturn(ctx, id, body));
  });

  app.get("/v1/inventory/goods-returns", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = itemQueryParams.parse(req.query);
    return reply.send({ data: await queries.listGoodsReturns(ctx.tenantId, q.limit, q.offset) });
  });

  registerErrorHandler(app);
}
