import { eq, and, inArray } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsAppraisals, type AppraisalRow, type AppraisalInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update">;

/**
 * `allowedEmployeeIds` (hrms_employees.id values), when given, restricts the
 * result to rows whose employeeId is in that set -- the read-scope guard
 * queries.ts's listAppraisals resolves via routes.ts's
 * resolveAppraisalReadScope. Omitted/undefined/null means unrestricted
 * (tenant-wide), matching the pre-fix behaviour for HR callers.
 */
export async function listByTenant(tenantId: string, limit = 100, allowedEmployeeIds?: string[] | null): Promise<AppraisalRow[]> {
  const conditions = [eq(hrmsAppraisals.tenantId, tenantId)];
  if (allowedEmployeeIds != null) {
    conditions.push(inArray(hrmsAppraisals.employeeId, allowedEmployeeIds));
  }
  return scopedRead((tx) => tx.select().from(hrmsAppraisals)
    .where(and(...conditions))
    .limit(limit));
}

export async function insertAppraisal(tx: Writer, row: AppraisalInsert): Promise<void> {
  await tx.insert(hrmsAppraisals).values(row);
}

export async function updateAppraisal(tx: Writer, id: string, patch: Partial<AppraisalInsert>): Promise<void> {
  await tx.update(hrmsAppraisals).set({ ...patch, updatedAt: new Date() }).where(eq(hrmsAppraisals.id, id));
}

export async function findById(id: string, tenantId: string): Promise<AppraisalRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsAppraisals).where(eq(hrmsAppraisals.id, id)).limit(1));
  const row = rows[0];
  return row && row.tenantId === tenantId ? row : null;
}

/**
 * Tx-scoped variant of findById: reads through the caller's already-open
 * transaction instead of opening a nested one via scopedRead.
 * appraisalAdvanceStage (consumer.ts) calls this from inside its own
 * db.transaction() -- the scopedRead-based findById would open a SECOND
 * transaction competing for a connection from the same pool as the outer
 * one, deadlocking every in-flight command once concurrency reaches
 * pool.max (see .claude/skills/16-production-readiness-audit.md section 1).
 */
export async function findByIdTx(tx: any, id: string, tenantId: string): Promise<AppraisalRow | null> {
  const rows = await tx.select().from(hrmsAppraisals).where(eq(hrmsAppraisals.id, id)).limit(1);
  const row = rows[0];
  return row && row.tenantId === tenantId ? row : null;
}
