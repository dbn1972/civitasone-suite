import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as vendorQueries from "../vendor/queries.js";
import * as tenderQueries from "../tender/queries.js";
import * as auctionQueries from "../auction/queries.js";
import { searchProducts, isEnabled as gemIsEnabled, GemAdapterError, CircuitBreakerOpenError } from "../gem/adapter.js";

const ROLES = ["procurement_officer", "procurement_admin", "finance_officer", "super_admin"];

function pageMeta(limit: number, offset: number, total: number): { page: number; pageSize: number; total: number } {
  return { page: Math.floor(offset / limit) + 1, pageSize: limit, total };
}

/**
 * Screens that used to be flat stubs — now backed by real repo/query data
 * (empanelment, bid-evaluations, reverse-auctions) or by an honest empty
 * response with a documented `meta.reason` where this system genuinely has
 * no matching resource (pre-bid-conferences) or the integration is
 * unconfigured (gem/items).
 */
export async function procurementGapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/bid-evaluations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await tenderQueries.listBidEvaluations(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data, meta: pageMeta(q.limit, q.offset, data.length) });
  });

  app.get("/v1/procurement/empanelment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await vendorQueries.listEmpanelments(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data, meta: pageMeta(q.limit, q.offset, data.length) });
  });

  /**
   * Aliases the live GeM catalog search (GET /v1/procurement/gem/products)
   * so this list is real data, not a stub — but only when both (a) the GeM
   * integration is enabled/configured AND (b) a search term is supplied.
   * Neither condition fabricates data: (a) surfaces meta.integrationDisabled,
   * (b) surfaces an honest empty list + meta.reason instead of guessing a
   * wildcard query against a real third-party catalog API.
   */
  app.get("/v1/procurement/gem/items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const query = z.object({
      q: z.string().min(1).max(256).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query);

    if (!gemIsEnabled()) {
      return reply.send({
        data: [],
        meta: {
          page: query.page ?? 1, pageSize: query.pageSize ?? 15, total: 0,
          integrationDisabled: true,
          reason: "GeM integration is not configured (GEM_ENABLED/GEM_BASE_URL/GEM_API_KEY).",
        },
      });
    }

    if (!query.q) {
      return reply.send({
        data: [],
        meta: {
          page: query.page ?? 1, pageSize: query.pageSize ?? 15, total: 0,
          reason: "no search query supplied — pass ?q= to search the live GeM catalog (aliases GET /v1/procurement/gem/products).",
        },
      });
    }

    try {
      const result = await searchProducts({ q: query.q, page: query.page, pageSize: query.pageSize });
      const data = result.products.map((p) => ({
        id: p.productId,
        orderId: p.productId,
        item: p.name,
        supplier: p.seller ?? "",
        amount: Number(p.unitPriceMinor) / 100,
        deliveryDate: "",
        gemStatus: p.availability,
      }));
      return reply.send({ data, meta: { page: result.page, pageSize: result.pageSize, total: result.total } });
    } catch (err) {
      const reason = err instanceof CircuitBreakerOpenError
        ? "GeM service is temporarily unavailable (circuit open)."
        : err instanceof GemAdapterError
          ? "GeM catalog search failed."
          : "GeM catalog search failed unexpectedly.";
      req.log.error({ err, adapter: "gem", action: "gapItemsSearch" }, reason);
      return reply.send({ data: [], meta: { page: query.page ?? 1, pageSize: query.pageSize ?? 15, total: 0, reason } });
    }
  });

  /**
   * This system models pre-bid Q&A as threaded text queries
   * (tender.procurement_prebid_queries), NOT scheduled meetings — there is no
   * attendee roster or meeting-date entity, so `attendees` is always 0 and
   * meta.reason always documents the substitution.
   */
  app.get("/v1/procurement/pre-bid-conferences", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await tenderQueries.listPreBidConferenceAggregates(ctx.tenantId, q.limit, q.offset);
    return reply.send({
      data,
      meta: {
        ...pageMeta(q.limit, q.offset, data.length),
        reason: "pre-bid conferences are aggregated from pre-bid query threads; this system does not track scheduled meetings or attendance, so 'attendees' is always 0.",
      },
    });
  });

  app.get("/v1/procurement/reverse-auctions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await auctionQueries.listAuctions(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data, meta: pageMeta(q.limit, q.offset, data.length) });
  });
}
