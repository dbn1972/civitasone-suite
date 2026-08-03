/**
 * steps/repo.ts — Database operations for step execution logs.
 */
import { eq, and, sql, desc, lte, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { scannerDb } from "../../shared/scanner-db.js";
import { stepExecutions, type StepExecutionRow, type StepExecutionInsert } from "./schema.js";

export function toView(r: StepExecutionRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    journeyId: r.journeyId,
    profileId: r.profileId,
    stepIndex: r.stepIndex,
    stepType: r.stepType,
    status: r.status,
    resumeAt: r.resumeAt?.toISOString() ?? null,
    failureCode: r.failureCode,
    failureReason: r.failureReason,
    executedAt: r.executedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type StepExecutionView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<StepExecutionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(stepExecutions).where(and(eq(stepExecutions.id, id), eq(stepExecutions.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByJourney(
  journeyId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: StepExecutionRow[]; total: number }> {
  const conditions: SQL[] = [
    eq(stepExecutions.tenantId, tenantId),
    eq(stepExecutions.journeyId, journeyId),
  ];
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(stepExecutions).where(where).orderBy(desc(stepExecutions.createdAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(stepExecutions).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: StepExecutionInsert): Promise<void> {
  await tx.insert(stepExecutions).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(stepExecutions)
    .set({
      status,
      executedAt: new Date(),
      updatedAt: new Date(),
      version: sql`${stepExecutions.version} + 1`,
    })
    .where(and(eq(stepExecutions.id, id), eq(stepExecutions.tenantId, tenantId), eq(stepExecutions.version, currentVersion)))
    .returning({ id: stepExecutions.id });
  return result.length > 0;
}

/**
 * Cross-tenant scan for parked `wait` steps whose delay has elapsed. Read-only,
 * via the scanner pool — see shared/scanner-db.ts for why RLS is bypassed here
 * and how the follow-up write stays tenant-scoped.
 */
export async function findDueWaits(now = new Date(), limit = 100): Promise<StepExecutionRow[]> {
  return scannerDb
    .select()
    .from(stepExecutions)
    .where(and(eq(stepExecutions.status, "waiting"), lte(stepExecutions.resumeAt, now)))
    .orderBy(stepExecutions.resumeAt)
    .limit(limit);
}

/**
 * Move a step from an expected status to a new one, carrying the dispatch
 * outcome. The `from` guard makes the transition a compare-and-set: a second
 * resume of the same wait step updates zero rows and returns false, so a
 * duplicated sweep cannot double-advance a run.
 */
export async function transitionStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  from: string,
  to: string,
  outcome: { failureCode?: string | null; failureReason?: string | null; resumeAt?: Date | null } = {},
): Promise<boolean> {
  const result = await tx
    .update(stepExecutions)
    .set({
      status: to,
      executedAt: new Date(),
      updatedAt: new Date(),
      version: sql`${stepExecutions.version} + 1`,
      ...(outcome.failureCode !== undefined ? { failureCode: outcome.failureCode } : {}),
      ...(outcome.failureReason !== undefined ? { failureReason: outcome.failureReason } : {}),
      ...(outcome.resumeAt !== undefined ? { resumeAt: outcome.resumeAt } : {}),
    })
    .where(and(eq(stepExecutions.id, id), eq(stepExecutions.tenantId, tenantId), eq(stepExecutions.status, from)))
    .returning({ id: stepExecutions.id });
  return result.length > 0;
}
