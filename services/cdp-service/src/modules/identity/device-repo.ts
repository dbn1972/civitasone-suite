/**
 * identity/device-repo.ts — CDP-007 device-token edges of the identity graph.
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { deviceTokens, type DeviceTokenRow } from "./schema.js";

/**
 * The token itself is never returned. A read of the device list is an
 * administrative/diagnostic view; echoing the token would let it be replayed against the
 * link endpoint from anywhere it leaked to. `tokenFingerprint` is the last four
 * characters, which is enough for a human to correlate a support call.
 */
export function toView(r: DeviceTokenRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    profileId: r.profileId,
    tokenFingerprint: r.deviceToken.slice(-4),
    deviceType: r.deviceType,
    lastSeenAt: r.lastSeenAt.toISOString(),
    version: r.version,
  };
}

export type DeviceView = ReturnType<typeof toView>;

export async function findByToken(deviceToken: string, tenantId: string): Promise<DeviceTokenRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(deviceTokens)
      .where(and(eq(deviceTokens.deviceToken, deviceToken), eq(deviceTokens.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByProfile(
  profileId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: DeviceTokenRow[]; total: number }> {
  const where = and(eq(deviceTokens.profileId, profileId), eq(deviceTokens.tenantId, tenantId));

  const rows = await scopedRead((tx) =>
    tx.select().from(deviceTokens)
      .where(where)
      .orderBy(desc(deviceTokens.lastSeenAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(deviceTokens).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function countByProfile(profileId: string, tenantId: string): Promise<number> {
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(deviceTokens)
      .where(and(eq(deviceTokens.profileId, profileId), eq(deviceTokens.tenantId, tenantId))),
  );
  return countResult[0]?.count ?? 0;
}

export async function insert(
  tx: ScopedTx,
  row: { id: string; tenantId: string; profileId: string; deviceToken: string; deviceType: string; lastSeenAt: Date },
): Promise<void> {
  await tx.insert(deviceTokens).values(row);
}

/**
 * Move an existing token to a different profile (or just refresh its last-seen stamp).
 * Optimistic-locked: a concurrent re-link would otherwise silently win and leave the
 * graph pointing at whichever writer finished last.
 */
export async function relink(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  currentVersion: number,
  patch: { profileId: string; deviceType: string; lastSeenAt: Date },
): Promise<boolean> {
  const result = await tx
    .update(deviceTokens)
    .set({ ...patch, version: sql`${deviceTokens.version} + 1` })
    .where(and(
      eq(deviceTokens.id, id),
      eq(deviceTokens.tenantId, tenantId),
      eq(deviceTokens.version, currentVersion),
    ))
    .returning({ id: deviceTokens.id });
  return result.length > 0;
}
