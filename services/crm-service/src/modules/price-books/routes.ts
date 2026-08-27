/**
 * Price-book routes (QP-002). Books + their per-product item prices, plus a resolve
 * endpoint that returns the highest-priority matching book. Writes are async-CQRS.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });
const minor = z.string().regex(/^\d{1,25}$/, "must be a non-negative integer string of minor units");

const itemBody = z.object({
  productId: z.string().uuid(),
  priceMinor: minor,
});
// Book-level create/update used to have no way to carry per-product prices at all: the
// frontend (PriceBookEditor.tsx) always sends the full current `entries` array on save,
// Zod silently stripped it (unknown key), and the consumer never touched
// crm.price_book_items — the only endpoint that persisted a price was the one-item-at-a-
// time PUT /:id/items below. `entries`, when present, is the book's COMPLETE desired set
// of prices (matching how the editor builds it — every remaining row after the user's
// edits, not a delta), applied transactionally with the book itself in the consumer.
// Omitting it entirely (e.g. a caller that only wants to patch `priority`) leaves
// existing entries untouched — same "undefined = don't touch" convention as every other
// optional field on updateBody.
const entriesField = z.array(itemBody).max(1000).optional();

const createBody = z.object({
  name: z.string().min(1).max(200),
  segment: z.string().min(1).max(120).nullable().optional(),
  currency: z.string().length(3).default("INR"),
  geography: z.string().min(1).max(120).nullable().optional(),
  channel: z.string().min(1).max(120).nullable().optional(),
  priority: z.number().int().min(0).max(100000).default(0),
  enabled: z.boolean().default(true),
  entries: entriesField,
});
const updateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  segment: z.string().min(1).max(120).nullable().optional(),
  currency: z.string().length(3).optional(),
  geography: z.string().min(1).max(120).nullable().optional(),
  channel: z.string().min(1).max(120).nullable().optional(),
  priority: z.number().int().min(0).max(100000).optional(),
  enabled: z.boolean().optional(),
  entries: entriesField,
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });

const resolveQuery = z.object({
  segment: z.string().min(1).max(120).optional(),
  currency: z.string().length(3).optional(),
  geography: z.string().min(1).max(120).optional(),
  channel: z.string().min(1).max(120).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function priceBookRoutes(app: FastifyInstance): Promise<void> {
  // Resolve must precede /:id so 'resolve' is not parsed as an id.
  app.get("/v1/crm/price-books/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = resolveQuery.parse(req.query ?? {});
    const book = await repo.resolve(ctx.tenantId, q);
    if (!book) return reply.send({ data: null });
    const items = await repo.listItems(ctx.tenantId, book.id);
    return reply.send({ data: { ...book, items } });
  });

  app.post("/v1/crm/price-books", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);
    const id = commandId(ctx, `${COMMANDS.createPriceBook}:${body.name}`);
    await queue.publish(COMMANDS.createPriceBook, {
      messageId: id, type: COMMANDS.createPriceBook, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/crm/price-books", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listQuery.parse(req.query ?? {});
    const { rows, total } = await repo.list(ctx.tenantId, q.limit, q.offset);
    // repo.list's own SELECT never carried items (list pages are meant to stay light),
    // but the editor's list view shows an "N prices" count per row and its Edit action
    // reuses this same row as its draft — without items attached here, every book looked
    // like it had zero saved prices until you separately GET'd it by id, which nothing in
    // the UI actually does. Same attach-items-per-book the single GET /:id already does
    // below; at admin-configured price-book cardinalities this stays cheap.
    const data = await Promise.all(rows.map(async (book) => ({ ...book, items: await repo.listItems(ctx.tenantId, book.id) })));
    return reply.send({ data, meta: { limit: q.limit, offset: q.offset, total } });
  });

  app.get("/v1/crm/price-books/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const book = await repo.findById(ctx.tenantId, id);
    if (!book) throw new HttpError(404, "NOT_FOUND", "price book not found");
    const items = await repo.listItems(ctx.tenantId, id);
    return reply.send({ data: { ...book, items } });
  });

  app.patch("/v1/crm/price-books/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "price book not found");
    const msgId = commandId(ctx, `${COMMANDS.updatePriceBook}:${id}`);
    await queue.publish(COMMANDS.updatePriceBook, {
      messageId: msgId, type: COMMANDS.updatePriceBook, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.delete("/v1/crm/price-books/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const msgId = commandId(ctx, `${COMMANDS.deletePriceBook}:${id}`);
    await queue.publish(COMMANDS.deletePriceBook, {
      messageId: msgId, type: COMMANDS.deletePriceBook, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.put("/v1/crm/price-books/:id/items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = itemBody.parse(req.body);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "price book not found");
    const msgId = commandId(ctx, `${COMMANDS.upsertPriceBookItem}:${id}:${body.productId}`);
    await queue.publish(COMMANDS.upsertPriceBookItem, {
      messageId: msgId, type: COMMANDS.upsertPriceBookItem, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, priceBookId: id, productId: body.productId, priceMinor: BigInt(body.priceMinor).toString() },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.delete("/v1/crm/price-books/:id/items/:productId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const params = z.object({ id: z.string().uuid(), productId: z.string().uuid() }).parse(req.params);
    const msgId = commandId(ctx, `${COMMANDS.deletePriceBookItem}:${params.id}:${params.productId}`);
    await queue.publish(COMMANDS.deletePriceBookItem, {
      messageId: msgId, type: COMMANDS.deletePriceBookItem, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, priceBookId: params.id, productId: params.productId },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });
}
