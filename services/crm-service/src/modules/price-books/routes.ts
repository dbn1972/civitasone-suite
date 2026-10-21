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
import { ALLOWED_CURRENCIES } from "../deals/quotation-domain.js";
import { resolveUserNames } from "../../shared/identity-names.js";
import * as repo from "./repo.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });
const minor = z.string().regex(/^\d{1,25}$/, "must be a non-negative integer string of minor units");
// F4-03: a price book carries a currency from the small allow-list (default INR).
const currencyCode = z.enum(ALLOWED_CURRENCIES);

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
  currency: currencyCode.default("INR"),
  geography: z.string().min(1).max(120).nullable().optional(),
  channel: z.string().min(1).max(120).nullable().optional(),
  priority: z.number().int().min(0).max(100000).default(0),
  enabled: z.boolean().default(true),
  entries: entriesField,
});
const updateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  segment: z.string().min(1).max(120).nullable().optional(),
  currency: currencyCode.optional(),
  geography: z.string().min(1).max(120).nullable().optional(),
  channel: z.string().min(1).max(120).nullable().optional(),
  priority: z.number().int().min(0).max(100000).optional(),
  enabled: z.boolean().optional(),
  entries: entriesField,
  // GAP-CRM-PRICE-BOOKS-01: why a LIVE book is being edited (the editor requires it for an
  // enabled book). Recorded against the new version in crm.price_book_history; it is not a
  // change to the book itself, so it does not count towards "at least one field".
  reason: z.string().trim().min(1).max(500).optional(),
}).refine((b) => Object.keys(b).some((k) => k !== "reason"), { message: "at least one field required" });

const resolveQuery = z.object({
  segment: z.string().min(1).max(120).optional(),
  currency: currencyCode.optional(),
  geography: z.string().min(1).max(120).optional(),
  channel: z.string().min(1).max(120).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GAP-CRM-PRICE-BOOKS-01: updated_by is an identity user uuid -- the editor must show WHO,
 * not a uuid. Attach `updatedByName` (null when identity cannot resolve it; fail-open).
 */
async function withUpdaterNames<T extends { updatedBy: string }>(
  tenantId: string,
  books: T[],
): Promise<Array<T & { updatedByName: string | null }>> {
  const names = await resolveUserNames(tenantId, books.map((b) => b.updatedBy));
  return books.map((b) => ({ ...b, updatedByName: names.get(b.updatedBy) ?? null }));
}

export async function priceBookRoutes(app: FastifyInstance): Promise<void> {
  // Resolve must precede /:id so 'resolve' is not parsed as an id.
  app.get("/v1/crm/price-books/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = resolveQuery.parse(req.query ?? {});
    const book = await repo.resolve(ctx.tenantId, q);
    if (!book) return reply.send({ data: null });
    const items = await repo.listItems(ctx.tenantId, book.id);
    const [named] = await withUpdaterNames(ctx.tenantId, [book]);
    return reply.send({ data: { ...named!, items } });
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
    // below. PERF-005: this used to be one repo.listItems() call per book row (N+1) --
    // batched into a single query via listItemsByBookIds.
    const itemsByBook = await repo.listItemsByBookIds(ctx.tenantId, rows.map((book) => book.id));
    const named = await withUpdaterNames(ctx.tenantId, rows);
    const data = named.map((book) => ({ ...book, items: itemsByBook.get(book.id) ?? [] }));
    return reply.send({ data, meta: { limit: q.limit, offset: q.offset, total } });
  });

  app.get("/v1/crm/price-books/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const book = await repo.findById(ctx.tenantId, id);
    if (!book) throw new HttpError(404, "NOT_FOUND", "price book not found");
    const items = await repo.listItems(ctx.tenantId, id);
    const [named] = await withUpdaterNames(ctx.tenantId, [book]);
    return reply.send({ data: { ...named!, items } });
  });

  // GAP-CRM-PRICE-BOOKS-01: the change history behind the editor's "History" drawer -- one
  // row per version (who, when, why, and which fields / product prices moved), newest first.
  // Admin-only: it carries the maker's stated reason and the before/after prices. Reads the
  // append-only crm.price_book_history written by the price-book consumer.
  app.get("/v1/crm/price-books/:id/history", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query ?? {});
    const book = await repo.findById(ctx.tenantId, id);
    if (!book) throw new HttpError(404, "NOT_FOUND", "price book not found");
    const { rows, total } = await repo.listHistory(ctx.tenantId, id, q.limit, q.offset);
    const names = await resolveUserNames(ctx.tenantId, rows.map((r) => r.changedBy));
    const data = rows.map((r) => ({ ...r, changedByName: names.get(r.changedBy) ?? null }));
    return reply.send({ data, meta: { limit: q.limit, offset: q.offset, total } });
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
