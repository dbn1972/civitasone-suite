/**
 * visitor-service: blacklist/watchlist reads.
 *
 * Mirrors `modules/location/repo.ts`'s shape: list queries go straight to
 * Postgres (RLS-scoped by tenant_id via the tenant-tx hook), single-entity
 * lookups use `cache.getOrLoad` read-through. Writes for this module go
 * through the CQRS command publishers in `./commands.ts` — this file is
 * read-only.
 *
 * `personName` is decrypted transparently by the `encryptedText()` Drizzle
 * column type on select (see shared/pii-crypto.ts) — callers here always
 * get cleartext.
 *
 * Requirement 18.6: Every PII read is logged to `pii_access_log` + outbox
 * `audit.event.record` via the shared DPDP helper when actor context is
 * provided.
 */
import { and, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { logPiiAccess } from "../dpdp/consent.js";
import {
  blacklistEntries, watchlistEntries,
  type BlacklistEntryRow, type WatchlistEntryRow,
} from "./schema.js";

const RESOURCE_BLACKLIST = "blacklist";

/** Optional actor context for PII access logging (Requirement 18.6). */
export interface PiiAccessContext {
  actorId: string;
  correlationId?: string;
}

export interface ListBlacklistFilter {
  status?: string | undefined;
  locationId?: string | undefined;
}

export async function listBlacklistEntries(tenantId: string, filter: ListBlacklistFilter = {}, piiCtx?: PiiAccessContext): Promise<BlacklistEntryRow[]> {
  const conditions = [eq(blacklistEntries.tenantId, tenantId)];
  if (filter.status !== undefined) conditions.push(eq(blacklistEntries.status, filter.status));
  if (filter.locationId !== undefined) conditions.push(eq(blacklistEntries.locationId, filter.locationId));
  const rows = await scopedRead((tx) => tx.select().from(blacklistEntries).where(and(...conditions)));

  // Requirement 18.6: log PII access for each row containing decrypted personName
  if (piiCtx && rows.length > 0) {
    await scopedRead(async (tx) => {
      for (const row of rows) {
        await logPiiAccess(tx, tenantId, piiCtx.actorId, "blacklist", row.id, "list_view", piiCtx.correlationId);
      }
    });
  }

  return rows;
}

/**
 * `visitor:{tenant}:blacklist:{id}` — cache.getOrLoad read-through. Returns
 * null (and does not cache) when the entry does not exist or belongs to
 * another tenant. Used by the `:id/approve` route to 404 before publishing.
 */
export async function getBlacklistEntryById(tenantId: string, id: string, piiCtx?: PiiAccessContext): Promise<BlacklistEntryRow | null> {
  const row = await cache.getOrLoad<BlacklistEntryRow>(cache.makeKey(tenantId, RESOURCE_BLACKLIST, id), async () => {
    const rows = await scopedRead((tx) => tx.select().from(blacklistEntries)
      .where(and(eq(blacklistEntries.id, id), eq(blacklistEntries.tenantId, tenantId))));
    return rows[0] ?? null;
  });

  // Requirement 18.6: log PII access when a row with decrypted PII is returned
  if (piiCtx && row) {
    await scopedRead((tx) => logPiiAccess(tx, tenantId, piiCtx.actorId, "blacklist", row.id, "detail_view", piiCtx.correlationId));
  }

  return row;
}

export interface ListWatchlistFilter {
  locationId?: string | undefined;
}

export async function listWatchlistEntries(tenantId: string, filter: ListWatchlistFilter = {}, piiCtx?: PiiAccessContext): Promise<WatchlistEntryRow[]> {
  const conditions = [eq(watchlistEntries.tenantId, tenantId)];
  if (filter.locationId !== undefined) conditions.push(eq(watchlistEntries.locationId, filter.locationId));
  const rows = await scopedRead((tx) => tx.select().from(watchlistEntries).where(and(...conditions)));

  // Requirement 18.6: log PII access for each row containing decrypted personName
  if (piiCtx && rows.length > 0) {
    await scopedRead(async (tx) => {
      for (const row of rows) {
        await logPiiAccess(tx, tenantId, piiCtx.actorId, "watchlist", row.id, "list_view", piiCtx.correlationId);
      }
    });
  }

  return rows;
}
