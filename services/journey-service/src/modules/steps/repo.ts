/**
 * steps/repo.ts — Database operations for step execution logs.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { stepExecutions, type StepExecutionRow, type StepExecutionInsert } from "./schema.js";

export function toView(r: StepExecutionRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    journeyId: r.journeyId,
    profileId: r.profileId,
    stepIndex: r.stepIndex,
    status: r.status,
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
