/**
 * visitor-service: visit-request reads.
 *
 * Mirrors `modules/blacklist/repo.ts`'s shape: list queries go straight to
 * Postgres (RLS-scoped by tenant_id via the tenant-tx hook), single-entity
 * lookups use `cache.getOrLoad` read-through. Writes for this module go
 * through the CQRS command publishers in `./commands.ts` — this file is
 * read-only.
 *
 * PII columns (`visitorName`, `visitorPhone`, `visitorEmail`,
 * `identityDocRef`) are decrypted transparently by the `encryptedText()`
 * Drizzle column type on select (see shared/pii-crypto.ts) — callers here
 * always get cleartext.
 *
 * Requirement 18.6: Every PII read is logged to `pii_access_log` + outbox
 * `audit.event.record` via the shared DPDP helper when actor context is
 * provided.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { logPiiAccess } from "../dpdp/consent.js";
import { visitRequests, type VisitRequestRow } from "./schema.js";

const RESOURCE_VISIT_REQUEST = "visit_request";

/** Optional actor context for PII access logging (Requirement 18.6). */
export interface PiiAccessContext {
  actorId: string;
  correlationId?: string;
}

export interface ListVisitRequestsFilter {
  status?: string | undefined;
  locationId?: string | undefined;
  hostEmployeeId?: string | undefined;
}

export async function listVisitRequests(tenantId: string, filter: ListVisitRequestsFilter = {}, piiCtx?: PiiAccessContext): Promise<VisitRequestRow[]> {
  const conditions = [eq(visitRequests.tenantId, tenantId)];
  if (filter.status !== undefined) conditions.push(eq(visitRequests.status, filter.status));
  if (filter.locationId !== undefined) conditions.push(eq(visitRequests.locationId, filter.locationId));
  if (filter.hostEmployeeId !== undefined) conditions.push(eq(visitRequests.hostEmployeeId, filter.hostEmployeeId));
  const rows = await db.select().from(visitRequests).where(and(...conditions));

  // Requirement 18.6: log PII access for each row containing decrypted PII
  if (piiCtx && rows.length > 0) {
    for (const row of rows) {
      await logPiiAccess(db, tenantId, piiCtx.actorId, "visit_request", row.id, "list_view", piiCtx.correlationId);
    }
  }

  return rows;
}

/**
 * `visitor:{tenant}:visit_request:{id}` — cache.getOrLoad read-through.
 * Returns null (and does not cache) when the request does not exist or
 * belongs to another tenant. Used by the detail/approve/reject/cancel
 * routes to 404 before publishing.
 */
export async function getVisitRequestById(tenantId: string, id: string, piiCtx?: PiiAccessContext): Promise<VisitRequestRow | null> {
  const row = await cache.getOrLoad<VisitRequestRow>(cache.makeKey(tenantId, RESOURCE_VISIT_REQUEST, id), async () => {
    const rows = await db.select().from(visitRequests)
      .where(and(eq(visitRequests.id, id), eq(visitRequests.tenantId, tenantId)));
    return rows[0] ?? null;
  });

  // Requirement 18.6: log PII access when a row with decrypted PII is returned
  if (piiCtx && row) {
    await logPiiAccess(db, tenantId, piiCtx.actorId, "visit_request", row.id, "detail_view", piiCtx.correlationId);
  }

  return row;
}
