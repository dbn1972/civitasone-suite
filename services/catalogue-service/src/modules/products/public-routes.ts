/**
 * PC-007 — read-optimised catalogue projection for portals, chatbot and field apps.
 *
 * ── Caching rationale ────────────────────────────────────────────────────────────
 * These endpoints are the highest-volume reads in the service: every portal page
 * load, every chatbot turn and every field-app sync hits them, and the answer is
 * identical for every caller within a tenant. Assembling the projection is also
 * the most expensive read we have — it needs the product row, its current
 * lifecycle state and its version-approval state. So the projection is built once
 * and served from `cache.getOrLoad` under a per-tenant key; the bounded TTL from
 * @civitasone/cache means a missed invalidation self-heals rather than serving a
 * stale catalogue forever.
 *
 * ── Filtering rationale ──────────────────────────────────────────────────────────
 * A product is only publishable when BOTH governance gates are open:
 *   1. its current lifecycle state is `active` (PC-002), and
 *   2. it has an `approved` version (PC-001).
 * Either gate alone is insufficient: an approved-but-retired product must not be
 * offered for sale, and an active product whose latest content was never approved
 * would leak unreviewed copy to citizens. The filter is applied server-side so no
 * client can opt out of it.
 *
 * ── Auth rationale ───────────────────────────────────────────────────────────────
 * "Public" here means "public-facing surface", NOT unauthenticated. A valid JWT is
 * still required — the tenant id in the token is what scopes the query and RLS.
 * The accepted role set is deliberately broader than the admin routes so portal,
 * chatbot and field-app service identities can read without catalogue-admin rights.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as productRepo from "./repo.js";
import * as repo from "./governance-repo.js";
import type { ProductRow } from "./schema.js";

/** Deliberately broad: portals, chatbot and field apps are all first-class readers. */
const PUBLIC_READ_ROLES = [
  "catalogue_user",
  "catalogue_admin",
  "catalogue_approver",
  "portal_user",
  "chatbot_service",
  "field_agent",
  "super_admin",
];

/** Max page size for the public list (repo-wide pagination ceiling). */
export const MAX_PUBLIC_LIMIT = 200;

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PUBLIC_LIMIT).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  category: z.string().min(1).max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

/** The trimmed shape exposed to public consumers — no audit or internal columns. */
export interface PublicProductProjection {
  id: string;
  productCode: string | null;
  name: string;
  description: string | null;
  category: string | null;
  taxRateBps: number;
  lifecycleState: string;
  approvedVersionNumber: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

function toProjection(product: ProductRow, lifecycleState: string, approvedVersionNumber: number): PublicProductProjection {
  return {
    id: product.id,
    productCode: product.productCode,
    name: product.name,
    description: product.description,
    category: product.category,
    taxRateBps: product.taxRateBps,
    lifecycleState,
    approvedVersionNumber,
    effectiveFrom: product.effectiveFrom,
    effectiveTo: product.effectiveTo,
  };
}

/**
 * Build the full publishable projection for a tenant.
 * Batched, not per-row: three set reads then an in-memory intersection, so the
 * cost is independent of catalogue size per product (no N+1).
 */
async function loadPublishable(tenantId: string): Promise<PublicProductProjection[]> {
  const [activeIds, approvedIds] = await Promise.all([
    repo.activeLifecycleProductIds(tenantId),
    repo.productIdsWithApprovedVersion(tenantId),
  ]);

  const approvedSet = new Set(approvedIds);
  const publishableIds = activeIds.filter((id) => approvedSet.has(id));
  if (publishableIds.length === 0) return [];

  const products = await productRepo.findByIds(publishableIds, tenantId);

  const projections: PublicProductProjection[] = [];
  for (const product of products) {
    const approved = await repo.findLatestApprovedVersion(product.id, tenantId);
    if (!approved) continue;
    projections.push(toProjection(product, "active", approved.versionNumber));
  }
  return projections.sort((a, b) => a.name.localeCompare(b.name));
}

export async function publicCatalogueRoutes(app: FastifyInstance): Promise<void> {
  // ─── Paginated public list ───────────────────────────────────────────────────
  app.get("/v1/catalogue/public/products", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PUBLIC_READ_ROLES);
    const q = listQuery.parse(req.query);

    // Cache-first: one key per tenant holds the whole publishable projection;
    // pagination and category filtering are applied to the cached array so a
    // portal paging through the catalogue never re-queries Postgres.
    const key = cache.makeKey(ctx.tenantId, "public-products", "all");
    const all = (await cache.getOrLoad(key, () => loadPublishable(ctx.tenantId))) ?? [];

    const filtered = q.category !== undefined ? all.filter((p) => p.category === q.category) : all;
    const rows = filtered.slice(q.offset, q.offset + q.limit);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({ data: rows, meta: { page, pageSize: q.limit, total: filtered.length } });
  });

  // ─── Single public projection ────────────────────────────────────────────────
  app.get("/v1/catalogue/public/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PUBLIC_READ_ROLES);
    const { id } = idParam.parse(req.params);

    const key = cache.makeKey(ctx.tenantId, "public-products", "all");
    const all = (await cache.getOrLoad(key, () => loadPublishable(ctx.tenantId))) ?? [];

    const found = all.find((p) => p.id === id);
    // 404 rather than 403 for a non-publishable product: its existence is not
    // something a public consumer is entitled to learn.
    if (!found) throw new HttpError(404, "NOT_FOUND", "Product not found in the published catalogue");

    return reply.send({ data: found });
  });
}
