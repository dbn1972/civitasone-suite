/**
 * visitor-service: gate-terminal offline-screening snapshot loader.
 *
 * The gate-sync endpoint (GET /v1/visitor/gate-sync/:gateId) ships this snapshot
 * to offline terminals so they can screen locally when the network is
 * intermittent (Requirement 5.6). It is built from the source-of-truth rows for
 * the gate's tenant+location:
 *   - blacklistHashes: active, unexpired blacklist blind-index hashes
 *   - watchlistHashes: active watchlist blind-index hashes
 *   - revokedPassIds:  revoked digital passes + revoked/suspended recurring passes
 *
 * Previously the loader returned empty arrays, so offline terminals synced
 * nothing and would admit blacklisted/revoked visitors while offline.
 *
 * Runs inside scopedRead so PostgreSQL RLS scopes every read to the current
 * tenant context (set by the request hook, or runWithTenant in tests/workers).
 */
import { and, eq, or, isNull, gt, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { blacklistEntries, watchlistEntries } from "../blacklist/schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { recurringPasses } from "../recurring-pass/schema.js";

export interface GateSyncSnapshot {
  revokedPassIds: string[];
  blacklistHashes: string[];
  watchlistHashes: string[];
}

const nonEmpty = (v: string | null): v is string => v !== null && v.length > 0;

/**
 * Build the offline-screening snapshot for a gate's tenant + location.
 * MUST be called with the tenant context active (RLS scopes each read).
 */
export async function loadGateSyncSnapshot(
  tenantId: string,
  locationId: string,
): Promise<GateSyncSnapshot> {
  const now = new Date();
  return scopedRead(async (tx) => {
    const [blRows, wlRows, dpRows, rpRows] = await Promise.all([
      // Active, unexpired blacklist blind-index hashes (location-scoped or global).
      tx
        .select({ h: blacklistEntries.identityDocHash })
        .from(blacklistEntries)
        .where(
          and(
            eq(blacklistEntries.tenantId, tenantId),
            eq(blacklistEntries.status, "active"),
            or(isNull(blacklistEntries.locationId), eq(blacklistEntries.locationId, locationId)),
            or(isNull(blacklistEntries.expiresAt), gt(blacklistEntries.expiresAt, now)),
          ),
        ),
      // Active watchlist blind-index hashes.
      tx
        .select({ h: watchlistEntries.identityDocHash })
        .from(watchlistEntries)
        .where(
          and(
            eq(watchlistEntries.tenantId, tenantId),
            eq(watchlistEntries.active, true),
            or(isNull(watchlistEntries.locationId), eq(watchlistEntries.locationId, locationId)),
          ),
        ),
      // Revoked digital passes at this location.
      tx
        .select({ id: digitalPasses.id })
        .from(digitalPasses)
        .where(
          and(
            eq(digitalPasses.tenantId, tenantId),
            eq(digitalPasses.locationId, locationId),
            or(eq(digitalPasses.status, "revoked"), eq(digitalPasses.revoked, true)),
          ),
        ),
      // Revoked or suspended recurring passes at this location.
      // BUG FIX: was `{ id: recurringPasses.id }` — the recurring_passes
      // row's OWN primary key, which never appears on any scanned QR.
      // revokedPassIds is matched against a pass's underlying digital-pass
      // id (recurring_passes.pass_id, FK to digital_passes.id), so select
      // that instead — same fix as recurring-pass/consumer.ts's dual-write
      // (recurring-pass-gate-revocation-gap.test.ts), applied to the
      // offline-terminal snapshot path.
      tx
        .select({ id: recurringPasses.passId })
        .from(recurringPasses)
        .where(
          and(
            eq(recurringPasses.tenantId, tenantId),
            eq(recurringPasses.locationId, locationId),
            inArray(recurringPasses.status, ["revoked", "suspended"]),
          ),
        ),
    ]);

    return {
      revokedPassIds: [...dpRows.map((r) => r.id), ...rpRows.map((r) => r.id)],
      blacklistHashes: blRows.map((r) => r.h).filter(nonEmpty),
      watchlistHashes: wlRows.map((r) => r.h).filter(nonEmpty),
    };
  });
}
