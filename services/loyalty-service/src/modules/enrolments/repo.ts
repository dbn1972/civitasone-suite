/**
 * enrolments/repo.ts — Database operations for member enrolments.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { enrolments, type EnrolmentRow, type EnrolmentInsert } from "./schema.js";

export function toView(r: EnrolmentRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    programId: r.programId,
    profileId: r.profileId,
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
