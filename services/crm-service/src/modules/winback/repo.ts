/**
 * winback/repo.ts — DB reads/writes for win-back cadences and enrollments.
 */
import { eq, and, desc, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  winbackCadences,
  winbackEnrollments,
  type WinbackCadenceRow,
  type WinbackCadenceView,
  type WinbackCadenceInsert,
  type WinbackEnrollmentRow,
  type WinbackEnrollmentView,
  type WinbackEnrollmentInsert,
} from "./schema.js";

// ── View mappers ────────────────────────────────────────────────────────────

export function cadenceToView(r: WinbackCadenceRow): WinbackCadenceView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    triggerCriteria: r.triggerCriteria ?? {},
    steps: r.steps ?? [],
    status: r.status,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function enrollmentToView(r: WinbackEnrollmentRow): WinbackEnrollmentView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    cadenceId: r.cadenceId,
    accountId: r.accountId,
    enrolledAt: r.enrolledAt.toISOString(),
    currentStep: r.currentStep,
    status: r.status,
    outcome: r.outcome,
    convertedAt: r.convertedAt?.toISOString() ?? null,
    version: r.version,
  };
}

// ── Cadence reads ───────────────────────────────────────────────────────────

export async function listCadences(
  tenantId: string,
  limit: number,
  offset: number,
  status?: string,
): Promise<{ rows: WinbackCadenceView[]; total: number }> {
  return scopedRead(async (tx) => {
    const where: SQL[] = [eq(winbackCadences.tenantId, tenantId)];
    if (status) where.push(eq(winbackCadences.status, status));
    const condition = and(...where);

    const rows = await tx
      .select()
      .from(winbackCadences)
      .where(condition)
      .orderBy(desc(winbackCadences.createdAt))
      .limit(limit)
      .offset(offset);

    const counted = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(winbackCadences)
      .where(condition);

    return { rows: rows.map(cadenceToView), total: counted[0]?.count ?? 0 };
  });
}

export async function getCadenceById(
  tenantId: string,
  id: string,
): Promise<WinbackCadenceView | null> {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(winbackCadences)
      .where(and(eq(winbackCadences.tenantId, tenantId), eq(winbackCadences.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? cadenceToView(row) : null;
  });
}

// ── Enrollment reads ────────────────────────────────────────────────────────

export async function listEnrollments(
  tenantId: string,
  limit: number,
  offset: number,
  filters: { cadenceId?: string; accountId?: string; status?: string } = {},
): Promise<{ rows: WinbackEnrollmentView[]; total: number }> {
  return scopedRead(async (tx) => {
    const where: SQL[] = [eq(winbackEnrollments.tenantId, tenantId)];
    if (filters.cadenceId) where.push(eq(winbackEnrollments.cadenceId, filters.cadenceId));
    if (filters.accountId) where.push(eq(winbackEnrollments.accountId, filters.accountId));
    if (filters.status) where.push(eq(winbackEnrollments.status, filters.status));
    const condition = and(...where);

    const rows = await tx
      .select()
      .from(winbackEnrollments)
      .where(condition)
      .orderBy(desc(winbackEnrollments.enrolledAt))
      .limit(limit)
      .offset(offset);

    const counted = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(winbackEnrollments)
      .where(condition);

    return { rows: rows.map(enrollmentToView), total: counted[0]?.count ?? 0 };
  });
}

export async function getEnrollmentById(
  tenantId: string,
  id: string,
): Promise<WinbackEnrollmentView | null> {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(winbackEnrollments)
      .where(and(eq(winbackEnrollments.tenantId, tenantId), eq(winbackEnrollments.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? enrollmentToView(row) : null;
  });
}

// ── Writer type (for consumers operating inside a transaction) ──────────────

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertCadence(tx: Writer, row: WinbackCadenceInsert): Promise<WinbackCadenceView> {
  const [inserted] = await tx
    .insert(winbackCadences)
    .values(row)
    .returning();
  return cadenceToView(inserted!);
}

export async function updateCadence(
  tx: Writer,
  tenantId: string,
  id: string,
  version: number,
  changes: Partial<WinbackCadenceInsert>,
): Promise<WinbackCadenceView | null> {
  const rows = await tx
    .update(winbackCadences)
    .set({ ...changes, version: version + 1, updatedAt: new Date() })
    .where(
      and(
        eq(winbackCadences.id, id),
        eq(winbackCadences.tenantId, tenantId),
        eq(winbackCadences.version, version),
      ),
    )
    .returning();
  const row = rows[0];
  return row ? cadenceToView(row) : null;
}

export async function insertEnrollment(tx: Writer, row: WinbackEnrollmentInsert): Promise<WinbackEnrollmentView> {
  const [inserted] = await tx
    .insert(winbackEnrollments)
    .values(row)
    .returning();
  return enrollmentToView(inserted!);
}

export async function updateEnrollment(
  tx: Writer,
  tenantId: string,
  id: string,
  version: number,
  changes: Partial<WinbackEnrollmentInsert>,
): Promise<WinbackEnrollmentView | null> {
  const rows = await tx
    .update(winbackEnrollments)
    .set({ ...changes, version: version + 1, updatedAt: new Date() })
    .where(
      and(
        eq(winbackEnrollments.id, id),
        eq(winbackEnrollments.tenantId, tenantId),
        eq(winbackEnrollments.version, version),
      ),
    )
    .returning();
  const row = rows[0];
  return row ? enrollmentToView(row) : null;
}
