/**
 * segments/membership-repo.ts — CDP-005 materialised segment membership.
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { segmentMemberships, type SegmentMembershipRow } from "./schema.js";
import { profiles } from "../profiles/schema.js";
import { buildWhereClause, type SegmentCriteria } from "./domain.js";

export function toView(r: SegmentMembershipRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    segmentId: r.segmentId,
    profileId: r.profileId,
    computedAt: r.computedAt.toISOString(),
    isRealtime: r.isRealtime,
    version: r.version,
  };
}

export type MembershipView = ReturnType<typeof toView>;

/** Page of persisted members, newest computation first. */
export async function listMembers(
  segmentId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: SegmentMembershipRow[]; total: number }> {
  const where = and(
    eq(segmentMemberships.tenantId, tenantId),
    eq(segmentMemberships.segmentId, segmentId),
  );

  const rows = await scopedRead((tx) =>
    tx.select().from(segmentMemberships)
      .where(where)
      .orderBy(desc(segmentMemberships.computedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(segmentMemberships).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function countMembers(segmentId: string, tenantId: string): Promise<number> {
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(segmentMemberships)
      .where(and(
        eq(segmentMemberships.tenantId, tenantId),
        eq(segmentMemberships.segmentId, segmentId),
      )),
  );
  return countResult[0]?.count ?? 0;
}

/** How many segments a profile belongs to — used by the profile summary projection. */
export async function countSegmentsForProfile(profileId: string, tenantId: string): Promise<number> {
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(segmentMemberships)
      .where(and(
        eq(segmentMemberships.tenantId, tenantId),
        eq(segmentMemberships.profileId, profileId),
      )),
  );
  return countResult[0]?.count ?? 0;
}

/**
 * Recompute membership for a segment inside the caller's transaction.
 *
 * The matching set is resolved set-wise in the database rather than by paging ids into
 * the service: a large tenant's audience does not fit in a request's memory budget, and
 * a paged read would see a shifting snapshot mid-run.
 *
 * `runAt` stamps every row this run touched; anything left with an older stamp no longer
 * matches the criteria and is removed. A recompute is therefore authoritative — including
 * over real-time rows, which is the point of a scheduled sweep.
 */
export async function recompute(
  tx: ScopedTx,
  tenantId: string,
  segmentId: string,
  criteria: SegmentCriteria,
  runAt: Date,
): Promise<number> {
  const where = buildWhereClause(criteria, tenantId);
  // Bound as ISO text with an explicit cast: in an INSERT ... SELECT the driver has no
  // column to infer a parameter type from, and it cannot serialise a bare Date into an
  // untyped placeholder.
  const stamp = runAt.toISOString();

  await tx.execute(sql`
    INSERT INTO cdp.segment_memberships (tenant_id, segment_id, profile_id, computed_at, is_realtime)
    SELECT ${tenantId}::uuid, ${segmentId}::uuid, ${profiles.id}, ${stamp}::timestamptz, false
    FROM ${profiles}
    WHERE ${where} AND ${profiles.profileType} <> 'merged'
    ON CONFLICT (tenant_id, segment_id, profile_id) DO UPDATE
      SET computed_at = ${stamp}::timestamptz,
          is_realtime = false,
          version = cdp.segment_memberships.version + 1
  `);

  await tx.execute(sql`
    DELETE FROM cdp.segment_memberships
    WHERE tenant_id = ${tenantId}::uuid
      AND segment_id = ${segmentId}::uuid
      AND computed_at <> ${stamp}::timestamptz
  `);

  const counted = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(segmentMemberships)
    .where(and(
      eq(segmentMemberships.tenantId, tenantId),
      eq(segmentMemberships.segmentId, segmentId),
    ));

  return counted[0]?.count ?? 0;
}

/**
 * Drop a profile out of every materialised audience it is in.
 *
 * Used by DSAR fulfilment (CDP-011): once erasure or rectification is under way the
 * profile must stop being handed to channels, and membership is the store this service
 * activates from. A hard delete is correct here — a membership row is derived data that a
 * later recompute rebuilds, so there is nothing to preserve, and a tombstone would keep
 * the subject inside the audiences the DPDP request exists to remove them from.
 *
 * Returns the number of audiences the profile was removed from.
 */
export async function deleteByProfile(tx: ScopedTx, profileId: string, tenantId: string): Promise<number> {
  const result = await tx
    .delete(segmentMemberships)
    .where(and(
      eq(segmentMemberships.tenantId, tenantId),
      eq(segmentMemberships.profileId, profileId),
    ))
    .returning({ id: segmentMemberships.id });
  return result.length;
}
