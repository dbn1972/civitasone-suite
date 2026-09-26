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
  return scopedRead((tx) => findRequestTx(tx, tenantId, id));
}

/** Tx-scoped variant of findRequest -- see .claude/skills/16-production-readiness-audit.md section 1. */
export async function findRequestTx(tx: Writer, tenantId: string, id: string): Promise<ScreeningOverrideRow | null> {
  const rows = await (tx as typeof db).select().from(hrmsScreeningOverrides)
    .where(and(eq(hrmsScreeningOverrides.tenantId, tenantId), eq(hrmsScreeningOverrides.id, id))).limit(1);
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
 *
 * Still used by cancel (R-RA-0111's lowest-severity checker action -- the
 * requester withdrawing their own request); approve/reject use
 * setRequestStatusIfPending below instead, since a bare version guard re-read
 * fresh inside the same async step it guards (as f3-consumer.ts's now-removed
 * "recruitment_screening_override_routes__1"/"__2" cases did) is
 * self-satisfying and never actually catches a race -- see that function's
 * doc comment.
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

/**
 * Atomically transition a PENDING override request (approve/reject), gated on
 * the row STILL being 'pending' in the very UPDATE statement that transitions
 * it -- not on a status read moments earlier by the route (R-RA-0111, mirrors
 * screening-repo.ts's setScreeningIfPending). Two genuinely concurrent checker
 * decisions on the same request (two approvals, or an approve racing a
 * reject) both read 'pending' before either write lands; this UPDATE's WHERE
 * clause is what actually serialises them under Postgres's row lock -- exactly
 * one affects a row (true), the other affects zero (false), because by the
 * time its WHERE is evaluated the winner has already committed and status is
 * no longer 'pending'.
 *
 * The caller MUST treat a `false` return as "someone else already decided
 * this request" (or its version moved for an unrelated reason) -- never
 * apply the patch's effects as if it had succeeded.
 */
export async function setRequestStatusIfPending(
  tx: Writer, tenantId: string, id: string,
  patch: Partial<ScreeningOverrideInsert>, expectedVersion: number,
): Promise<boolean> {
  const res = await tx.update(hrmsScreeningOverrides)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(
      eq(hrmsScreeningOverrides.tenantId, tenantId),
      eq(hrmsScreeningOverrides.id, id),
      eq(hrmsScreeningOverrides.status, "pending"),
      eq(hrmsScreeningOverrides.version, expectedVersion),
    ));
  return affected(res) > 0;
}
