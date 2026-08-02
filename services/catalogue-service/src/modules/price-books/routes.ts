/**
 * QP-002 — price books by segment, currency and geography.
 *
 * ── MONEY RULE (non-negotiable) ─────────────────────────────────────────────────
 * `amountMinor` is a bigint of MINOR UNITS (paise) in the database, is validated
 * as a bigint at the route boundary, and is ALWAYS serialised to JSON as a STRING.
 * It is never a JSON number and never a float, so a price above 2^53 (which a
 * double cannot represent) round-trips byte-exact. All arithmetic uses BigInt().
 *
 * Mutations are queue-first (CQRS): validate → publish command → 202 Accepted.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { PRICE_BOOK_STATUSES, type PriceBookRow, type PriceBookEntryRow } from "./schema.js";
import { resolveEffectivePrice, taxOnAmountMinor, type CandidateBook, type CandidateEntry } from "./domain.js";
import * as productRepo from "../products/repo.js";
import * as commands from "./commands.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "pricing_officer", "super_admin"];
const WRITE_ROLES = ["catalogue_admin", "pricing_officer", "super_admin"];

/** A single PUT may not rewrite more than this many entries. */
export const MAX_PRICE_BOOK_ENTRIES = 500;

const idParam = z.object({ id: z.string().uuid() });

const geographySchema = z.object({
  circleCode: z.string().min(1).max(50).optional(),
  regionCode: z.string().min(1).max(50).optional(),
  officeCode: z.string().min(1).max(50).optional(),
});

const currencySchema = z.string().length(3).regex(/^[A-Z]{3}$/, "currency must be an uppercase ISO 4217 code");

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(PRICE_BOOK_STATUSES).optional(),
  segment: z.string().min(1).max(64).optional(),
  currency: currencySchema.optional(),
});

const createBody = z.object({
  name: z.string().min(1).max(200),
  segment: z.string().min(1).max(64),
  currency: currencySchema,
  geography: geographySchema.default({}),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
  status: z.enum(PRICE_BOOK_STATUSES).default("draft"),
});

const patchBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    segment: z.string().min(1).max(64).optional(),
    currency: currencySchema.optional(),
    geography: geographySchema.optional(),
    effectiveFrom: z.string().datetime().optional(),
    effectiveTo: z.string().datetime().nullable().optional(),
    status: z.enum(PRICE_BOOK_STATUSES).optional(),
    /** Optional optimistic-lock guard. Falls back to the row's current version. */
    version: z.number().int().positive().optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== "version"), { message: "at least one field must be provided" });

const entriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const putEntriesBody = z.object({
  entries: z
    .array(
      z.object({
        productId: z.string().uuid(),
        /**
         * Accepted as a decimal STRING of minor units. z.coerce.bigint() rejects any
         * fractional input, which is exactly what we want: paise are indivisible.
         */
        amountMinor: z.coerce.bigint().nonnegative(),
        currency: currencySchema.optional(),
      }),
    )
    .max(MAX_PRICE_BOOK_ENTRIES),
});

const resolveQuery = z.object({
  productId: z.string().uuid(),
  segment: z.string().min(1).max(64),
  currency: currencySchema,
  circleCode: z.string().min(1).max(50).optional(),
  regionCode: z.string().min(1).max(50).optional(),
  officeCode: z.string().min(1).max(50).optional(),
});

function serialiseBook(row: PriceBookRow) {
  return {
    id: row.id,
    name: row.name,
    segment: row.segment,
    currency: row.currency,
    geography: row.geography,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serialiseEntry(row: PriceBookEntryRow) {
  return {
    id: row.id,
    priceBookId: row.priceBookId,
    productId: row.productId,
    // MONEY RULE: bigint → string. Never a JSON number.
    amountMinor: row.amountMinor.toString(),
    currency: row.currency,
    version: row.version,
  };
}

export async function priceBookRoutes(app: FastifyInstance): Promise<void> {
  // ─── Resolve the effective price ─────────────────────────────────────────────
  // Registered before `/price-books/:id` so `resolve` is never read as an id.
  app.get("/v1/catalogue/price-books/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = resolveQuery.parse(req.query);

    const books = await repo.listBooksForResolve(ctx.tenantId, q.segment, q.currency);
    if (books.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "No active price book matches that segment and currency");
    }

    const entries = await repo.listEntriesForProduct(
      ctx.tenantId,
      q.productId,
      books.map((b) => b.id),
    );

    const candidateBooks: CandidateBook[] = books.map((b) => ({
      id: b.id,
      segment: b.segment,
      currency: b.currency,
      geography: b.geography,
      effectiveFrom: b.effectiveFrom,
      effectiveTo: b.effectiveTo,
      status: b.status,
    }));
    const candidateEntries: CandidateEntry[] = entries.map((e) => ({
      priceBookId: e.priceBookId,
      productId: e.productId,
      amountMinor: e.amountMinor,
      currency: e.currency,
    }));

    const resolved = resolveEffectivePrice(candidateBooks, candidateEntries, {
      productId: q.productId,
      segment: q.segment,
      currency: q.currency,
      geography: {
        ...(q.circleCode !== undefined ? { circleCode: q.circleCode } : {}),
        ...(q.regionCode !== undefined ? { regionCode: q.regionCode } : {}),
        ...(q.officeCode !== undefined ? { officeCode: q.officeCode } : {}),
      },
    });

    if (!resolved) {
      throw new HttpError(404, "NOT_FOUND", "No price is configured for that product in the matching price books");
    }

    // Tax is derived from the product's QP-001 basis-point rate, in BigInt.
    const product = await productRepo.findById(q.productId, ctx.tenantId);
    const taxRateBps = product?.taxRateBps ?? 0;
    const taxMinor = taxOnAmountMinor(resolved.amountMinor, taxRateBps);

    return reply.send({
      data: {
        productId: resolved.productId,
        priceBookId: resolved.priceBookId,
        // MONEY RULE: every amount is a string of minor units.
        amountMinor: resolved.amountMinor.toString(),
        taxRateBps,
        taxAmountMinor: taxMinor.toString(),
        totalAmountMinor: (resolved.amountMinor + taxMinor).toString(),
        currency: resolved.currency,
        specificity: resolved.specificity,
      },
    });
  });

  // ─── List price books ────────────────────────────────────────────────────────
  app.get("/v1/catalogue/price-books", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listPriceBooks({
      tenantId: ctx.tenantId,
      limit: q.limit,
      offset: q.offset,
      status: q.status,
      segment: q.segment,
      currency: q.currency,
    });
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(serialiseBook), meta: { page, pageSize: q.limit, total } });
  });

  // ─── Create a price book ─────────────────────────────────────────────────────
  app.post("/v1/catalogue/price-books", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createBody.parse(req.body);

    const effectiveFrom = body.effectiveFrom !== undefined ? new Date(body.effectiveFrom) : new Date();
    const effectiveTo = body.effectiveTo !== undefined ? new Date(body.effectiveTo) : null;
    if (effectiveTo !== null && effectiveTo.getTime() < effectiveFrom.getTime()) {
      throw new HttpError(422, "INVALID_EFFECTIVE_WINDOW", "effectiveTo must not precede effectiveFrom");
    }

    return reply.code(202).send(
      await commands.createPriceBook(ctx, {
        name: body.name,
        segment: body.segment,
        currency: body.currency,
        geography: body.geography,
        effectiveFrom: effectiveFrom.toISOString(),
        effectiveTo: effectiveTo !== null ? effectiveTo.toISOString() : null,
        status: body.status,
      }),
    );
  });

  // ─── Patch a price book ──────────────────────────────────────────────────────
  app.patch("/v1/catalogue/price-books/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = patchBody.parse(req.body);

    const existing = await repo.findPriceBookById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Price book not found");

    const nextFrom = body.effectiveFrom !== undefined ? new Date(body.effectiveFrom) : existing.effectiveFrom;
    const nextTo =
      body.effectiveTo === undefined
        ? existing.effectiveTo
        : body.effectiveTo === null
          ? null
          : new Date(body.effectiveTo);
    if (nextTo !== null && nextTo.getTime() < nextFrom.getTime()) {
      throw new HttpError(422, "INVALID_EFFECTIVE_WINDOW", "effectiveTo must not precede effectiveFrom");
    }

    if (body.version !== undefined && body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "Price book has been modified; retry with current version");
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.name !== undefined) patch["name"] = body.name;
    if (body.segment !== undefined) patch["segment"] = body.segment;
    if (body.currency !== undefined) patch["currency"] = body.currency;
    if (body.geography !== undefined) patch["geography"] = body.geography;
    if (body.effectiveFrom !== undefined) patch["effectiveFrom"] = nextFrom.toISOString();
    if (body.effectiveTo !== undefined) patch["effectiveTo"] = nextTo !== null ? nextTo.toISOString() : null;
    if (body.status !== undefined) patch["status"] = body.status;

    const expectedVersion = body.version ?? existing.version;
    return reply.code(202).send(await commands.updatePriceBook(ctx, id, { version: expectedVersion, patch }));
  });

  // ─── List a book's entries ───────────────────────────────────────────────────
  app.get("/v1/catalogue/price-books/:id/entries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = entriesQuery.parse(req.query);

    const book = await repo.findPriceBookById(id, ctx.tenantId);
    if (!book) throw new HttpError(404, "NOT_FOUND", "Price book not found");

    const { rows, total } = await repo.listEntries(id, ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(serialiseEntry), meta: { page, pageSize: q.limit, total } });
  });

  // ─── Replace a book's entries ────────────────────────────────────────────────
  app.put("/v1/catalogue/price-books/:id/entries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = putEntriesBody.parse(req.body);

    const book = await repo.findPriceBookById(id, ctx.tenantId);
    if (!book) throw new HttpError(404, "NOT_FOUND", "Price book not found");

    // UNIQUE (tenant_id, price_book_id, product_id) — reject duplicates with a
    // clear 422 instead of letting the constraint surface as a 500.
    const seen = new Set<string>();
    for (const entry of body.entries) {
      if (seen.has(entry.productId)) {
        throw new HttpError(422, "DUPLICATE_ENTRY", `Product ${entry.productId} appears more than once`);
      }
      seen.add(entry.productId);
      const currency = entry.currency ?? book.currency;
      if (currency !== book.currency) {
        throw new HttpError(
          422,
          "CURRENCY_MISMATCH",
          `Entry currency '${currency}' does not match the price book currency '${book.currency}'`,
        );
      }
    }

    const entries = body.entries.map((entry) => ({
      id: randomUUID(),
      productId: entry.productId,
      amountMinor: entry.amountMinor.toString(),
      currency: entry.currency ?? book.currency,
    }));
    const totalAmountMinor = body.entries.reduce((sum, e) => sum + e.amountMinor, 0n).toString();

    return reply.code(202).send(
      await commands.replacePriceBookEntries(ctx, id, { entries, totalAmountMinor }),
    );
  });
}
