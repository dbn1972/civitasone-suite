import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  hrmsScreeningOverrides,
  type ScreeningOverrideRow, type ScreeningOverrideInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

function affected(res: unknown): number {
  const r = res as { rowCount?: number; count?: number };
  return r.rowCount ?? r.count ?? 0;
}

export async function createRequest(tx: Writer, row: ScreeningOverrideInsert): Promise<void> {
  await tx.insert(hrmsScreeningOverrides).values(row);
}

export async function findRequest(tenantId: string, id: string): Promise<ScreeningOverrideRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsScreeningOverrides)
    .where(and(eq(hrmsScreeningOverrides.tenantId, tenantId), eq(hrmsScreeningOverrides.id, id))).limit(1));
  return rows[0] ?? null;
}

/** The current pending override request for an application, if any. */
export async function findPendingForApplication(tenantId: string, applicationId: string): Promise<ScreeningOverrideRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsScreeningOverrides)
    .where(and(
      eq(hrmsScreeningOverrides.tenantId, tenantId),
      eq(hrmsScreeningOverrides.applicationId, applicationId),
      eq(hrmsScreeningOverrides.status, "pending"),
    )).limit(1));
  return rows[0] ?? null;
}

export async function listForApplication(tenantId: string, applicationId: string): Promise<ScreeningOverrideRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsScreeningOverrides)
    .where(and(eq(hrmsScreeningOverrides.tenantId, tenantId), eq(hrmsScreeningOverrides.applicationId, applicationId)))
    .orderBy(desc(hrmsScreeningOverrides.requestedAt)));
}

/**
 * Transition an override request (approve/reject/cancel), guarded by optimistic
 * version so two approvers cannot both act on the same pending request. Throws
 * "VERSION_CONFLICT" when the row moved on under us.
 */
export async function setRequestStatus(
  tx: Writer, tenantId: string, id: string,
  patch: Partial<ScreeningOverrideInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsScreeningOverrides)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(
      eq(hrmsScreeningOverrides.tenantId, tenantId),
      eq(hrmsScreeningOverrides.id, id),
      eq(hrmsScreeningOverrides.version, expectedVersion),
    ));
  if (affected(res) === 0) throw new Error("VERSION_CONFLICT");
}
