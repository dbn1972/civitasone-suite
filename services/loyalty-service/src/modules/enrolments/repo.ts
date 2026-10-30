/**
 * enrolments/repo.ts — Database operations for member enrolments.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { enrolments, type EnrolmentRow, type EnrolmentInsert } from "./schema.js";

/** Shortened, non-reversible display reference for a profile id (first UUID group). */
export function shortProfileRef(profileId: string): string {
  return profileId.slice(0, 8);
}

export function toView(r: EnrolmentRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    programId: r.programId,
    // D4c #14/#15: the profile id is personal data. Views carry only a shortened reference;
    // the full id is available solely through the audited reveal route.
    profileRef: shortProfileRef(r.profileId),
    status: r.status,
    tier: r.tier,
    pointsBalance: r.pointsBalance.toString(),
    lifetimePoints: r.lifetimePoints.toString(),
    enrolledAt: r.enrolledAt.toISOString(),
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export type EnrolmentView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<EnrolmentRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(enrolments).where(and(eq(enrolments.id, id), eq(enrolments.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

/**
 * TX-001 — tenant-scoped sibling of findById(). Reads through a
 * caller-supplied transaction handle so an already-open db.transaction()
 * (redemptions' voidRedemption consumer, reading the enrolment before
 * restoring its points) does not open a second, bare db.transaction() from
 * inside itself via scopedRead(): under pool.max concurrent in-flight
 * consumer transactions, the nested call has no free connection to open on
 * and deadlocks the pool silently. Route every read that happens inside an
 * already-open consumer transaction through this, not findById().
 */
export async function findByIdTx(tx: ScopedTx, id: string, tenantId: string): Promise<EnrolmentRow | null> {
  const rows = await tx.select().from(enrolments).where(and(eq(enrolments.id, id), eq(enrolments.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findByProgramAndProfile(
  tenantId: string,
  programId: string,
  profileId: string,
): Promise<EnrolmentRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(enrolments)
      .where(
        and(
          eq(enrolments.tenantId, tenantId),
          eq(enrolments.programId, programId),
          eq(enrolments.profileId, profileId),
        ),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByProgram(
  tenantId: string,
  programId: string,
  limit: number,
  offset: number,
): Promise<{ rows: EnrolmentRow[]; total: number }> {
  const where: SQL = and(eq(enrolments.tenantId, tenantId), eq(enrolments.programId, programId))!;

  const rows = await scopedRead((tx) =>
    tx.select().from(enrolments).where(where).orderBy(desc(enrolments.enrolledAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(enrolments).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

/**
 * All enrolments for the tenant. Backs GET /v1/loyalty/enrolments when no
 * programId filter is supplied — that previously returned a hardcoded empty
 * list, so callers could not enumerate a tenant's members at all.
 */
export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: EnrolmentRow[]; total: number }> {
  const where: SQL = eq(enrolments.tenantId, tenantId);

  const rows = await scopedRead((tx) =>
    tx.select().from(enrolments).where(where).orderBy(desc(enrolments.enrolledAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(enrolments).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function listByProfile(
  tenantId: string,
  profileId: string,
  limit: number,
  offset: number,
): Promise<{ rows: EnrolmentRow[]; total: number }> {
  const where: SQL = and(eq(enrolments.tenantId, tenantId), eq(enrolments.profileId, profileId))!;

  const rows = await scopedRead((tx) =>
    tx.select().from(enrolments).where(where).orderBy(desc(enrolments.enrolledAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(enrolments).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: EnrolmentInsert): Promise<void> {
  await tx.insert(enrolments).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<EnrolmentInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(enrolments)
    .set({ ...patch, updatedAt: new Date(), version: sql`${enrolments.version} + 1` })
    .where(and(eq(enrolments.id, id), eq(enrolments.tenantId, tenantId), eq(enrolments.version, currentVersion)))
    .returning({ id: enrolments.id });
  return result.length > 0;
}

export async function adjustBalance(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  pointsDelta: bigint,
  lifetimeDelta: bigint,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(enrolments)
    .set({
      pointsBalance: sql`${enrolments.pointsBalance} + ${pointsDelta.toString()}::bigint`,
      lifetimePoints: sql`${enrolments.lifetimePoints} + ${lifetimeDelta.toString()}::bigint`,
      updatedAt: new Date(),
      version: sql`${enrolments.version} + 1`,
    })
    .where(and(eq(enrolments.id, id), eq(enrolments.tenantId, tenantId), eq(enrolments.version, currentVersion)))
    .returning({ id: enrolments.id });
  return result.length > 0;
}

/**
 * CLOS3-S5-03: additive credit that does not depend on the enqueue-time
 * version. A delta applied with `balance = balance + delta` is commutative, so
 * the optimistic lock adds nothing for accrual and only made concurrent or
 * stale-version accruals commit a ledger row with no balance effect. Still
 * bumps `version` so readers holding an older version are invalidated.
 * Returns false only when the enrolment row does not exist for the tenant.
 */
export async function creditPoints(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  pointsDelta: bigint,
  lifetimeDelta: bigint,
): Promise<boolean> {
  const result = await tx
    .update(enrolments)
    .set({
      pointsBalance: sql`${enrolments.pointsBalance} + ${pointsDelta.toString()}::bigint`,
      lifetimePoints: sql`${enrolments.lifetimePoints} + ${lifetimeDelta.toString()}::bigint`,
      updatedAt: new Date(),
      version: sql`${enrolments.version} + 1`,
    })
    .where(and(eq(enrolments.id, id), eq(enrolments.tenantId, tenantId)))
    .returning({ id: enrolments.id });
  return result.length > 0;
}

/**
 * CLOS3-S5-02/03: adjustBalance() is optimistic-lock guarded and returns false
 * when it matched 0 rows. Consumers must call this inside their db.transaction
 * so the thrown error rolls back the ledger row, outbox event and audit row
 * instead of committing a ledger entry with no balance effect.
 */
export class BalanceConflictError extends Error {
  constructor(enrolmentId: string, action: string) {
    super(`${action}: enrolment ${enrolmentId} balance not adjusted (version conflict or missing row)`);
    this.name = "BalanceConflictError";
  }
}

export function assertBalanceAdjusted(ok: boolean, enrolmentId: string, action: string): void {
  if (!ok) throw new BalanceConflictError(enrolmentId, action);
}
