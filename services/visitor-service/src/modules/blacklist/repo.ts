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
import { and, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { logPiiAccess } from "../dpdp/consent.js";
import { normalizeName, FUZZY_NAME_THRESHOLD } from "./domain.js";
import {
  blacklistEntries, watchlistEntries,
  type BlacklistEntryRow, type WatchlistEntryRow,
} from "./schema.js";

/** A non-blocking fuzzy/alias screening hit (raises a REVIEW flag, never a deny). */
export interface FuzzyScreenMatch {
  id: string;
  list: "blacklist" | "watchlist";
  similarity: number;
}

/**
 * Fix 3 — non-blocking fuzzy/alias screening layer. Trigram-similarity match of
 * a candidate visitor name against the tenant's ACTIVE blacklist + watchlist
 * `name_normalized` keys (migration 0012). Returns the hits at or above
 * `threshold`, sorted most-similar first. This complements — never replaces —
 * the exact blind-index (identity_doc_hash) hard-block: a match here raises a
 * REVIEW flag for the guard, it does NOT auto-deny.
 *
 * RLS-scoped: runs under scopedRead (GUC-set tenant tx) AND carries an explicit
 * tenant_id predicate, so it only ever sees the caller tenant's rows.
 */
export async function fuzzyScreenName(
  tenantId: string, name: string, threshold: number = FUZZY_NAME_THRESHOLD,
): Promise<FuzzyScreenMatch[]> {
  const norm = normalizeName(name);
  if (!norm) return [];

  return scopedRead(async (tx) => {
    const blRows = (await tx.execute(sql`
      SELECT id, similarity(name_normalized, ${norm}) AS sim
      FROM visitor.blacklist_entries
      WHERE tenant_id = ${tenantId}::uuid
        AND status = 'active'
        AND name_normalized IS NOT NULL
        AND similarity(name_normalized, ${norm}) >= ${threshold}
      ORDER BY sim DESC
      LIMIT 20
    `)) as unknown as Array<{ id: string; sim: number }>;

    const wlRows = (await tx.execute(sql`
      SELECT id, similarity(name_normalized, ${norm}) AS sim
      FROM visitor.watchlist_entries
      WHERE tenant_id = ${tenantId}::uuid
        AND active = true
        AND name_normalized IS NOT NULL
        AND similarity(name_normalized, ${norm}) >= ${threshold}
      ORDER BY sim DESC
      LIMIT 20
    `)) as unknown as Array<{ id: string; sim: number }>;

    const matches: FuzzyScreenMatch[] = [
      ...blRows.map((r) => ({ id: r.id, list: "blacklist" as const, similarity: Number(r.sim) })),
      ...wlRows.map((r) => ({ id: r.id, list: "watchlist" as const, similarity: Number(r.sim) })),
    ];
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches;
  });
}

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
