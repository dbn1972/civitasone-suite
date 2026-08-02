/**
 * identity/visitor-repo.ts — CR-CDP-04 anonymous visitor register.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { anonymousVisitors, type AnonymousVisitorRow, type AnonymousVisitorInsert } from "./schema.js";

/**
 * The visitor key hash is never returned in full. It is a stable pseudonymous identifier
 * for a device, so echoing it would let a caller correlate visitors across responses
 * without ever holding a profile. The first 12 characters match what lineage records,
 * which is what a support investigation needs.
 */
export function toView(r: AnonymousVisitorRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    visitorRef: r.visitorKeyHash.slice(0, 12),
    anonymousProfileId: r.anonymousProfileId,
    mergedIntoProfileId: r.mergedIntoProfileId,
    status: r.status,
    deviceType: r.deviceType,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    mergedAt: r.mergedAt === null ? null : r.mergedAt.toISOString(),
    eventsMerged: r.eventsMerged,
    identifiersMerged: r.identifiersMerged,
    devicesMerged: r.devicesMerged,
    version: r.version,
  };
}

export type AnonymousVisitorView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<AnonymousVisitorRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(anonymousVisitors)
      .where(and(eq(anonymousVisitors.id, id), eq(anonymousVisitors.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByHash(visitorKeyHash: string, tenantId: string): Promise<AnonymousVisitorRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(anonymousVisitors)
      .where(and(
        eq(anonymousVisitors.visitorKeyHash, visitorKeyHash),
        eq(anonymousVisitors.tenantId, tenantId),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: { status?: string } = {},
): Promise<{ rows: AnonymousVisitorRow[]; total: number }> {
  const conditions: SQL[] = [eq(anonymousVisitors.tenantId, tenantId)];
  if (filters.status !== undefined) conditions.push(eq(anonymousVisitors.status, filters.status));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(anonymousVisitors)
      .where(where)
      .orderBy(desc(anonymousVisitors.lastSeenAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(anonymousVisitors).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: AnonymousVisitorInsert): Promise<void> {
  await tx.insert(anonymousVisitors).values(row);
}

/**
 * Refresh a returning visitor's last-seen stamp.
 *
 * Not optimistic-locked: a lost update on a heartbeat is a slightly stale timestamp, and
 * making a page view fail with 409 because two tabs raced would be worse. The
 * `status = 'anonymous'` guard is what matters — a heartbeat must never revive a visitor
 * that has already been stitched.
 */
export async function touch(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: { lastSeenAt: Date; deviceType: string; updatedBy: string },
): Promise<void> {
  await tx
    .update(anonymousVisitors)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(
      eq(anonymousVisitors.id, id),
      eq(anonymousVisitors.tenantId, tenantId),
      eq(anonymousVisitors.status, "anonymous"),
    ));
}

/**
 * Record the stitch. Optimistic-locked *and* guarded on `status = 'anonymous'`, so two
 * concurrent stitches cannot both move the same events.
 */
export async function markMerged(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: {
    mergedIntoProfileId: string;
    eventsMerged: number;
    identifiersMerged: number;
    devicesMerged: number;
    mergedAt: Date;
    updatedBy: string;
  },
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(anonymousVisitors)
    .set({
      ...patch,
      status: "merged",
      updatedAt: new Date(),
      version: sql`${anonymousVisitors.version} + 1`,
    })
    .where(and(
      eq(anonymousVisitors.id, id),
      eq(anonymousVisitors.tenantId, tenantId),
      eq(anonymousVisitors.status, "anonymous"),
      eq(anonymousVisitors.version, currentVersion),
    ))
    .returning({ id: anonymousVisitors.id });
  return result.length > 0;
}
