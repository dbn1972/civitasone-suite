/**
 * executions/repo.ts — Database operations for journey execution instances.
 */
import { eq, and, sql, desc, inArray, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { journeyExecutions, type JourneyExecutionRow, type JourneyExecutionInsert } from "./schema.js";

export function toView(r: JourneyExecutionRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    journeyId: r.journeyId,
    profileId: r.profileId,
    status: r.status,
    currentStepIndex: r.currentStepIndex,
    enrolledAt: r.enrolledAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export type ExecutionView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<JourneyExecutionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(journeyExecutions)
      .where(and(eq(journeyExecutions.id, id), eq(journeyExecutions.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  journeyId?: string;
  profileId?: string;
  status?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: JourneyExecutionRow[]; total: number }> {
  const conditions: SQL[] = [eq(journeyExecutions.tenantId, tenantId)];

  if (filters.journeyId) {
    conditions.push(eq(journeyExecutions.journeyId, filters.journeyId));
  }
  if (filters.profileId) {
    conditions.push(eq(journeyExecutions.profileId, filters.profileId));
  }
  if (filters.status) {
    conditions.push(eq(journeyExecutions.status, filters.status));
  }

  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(journeyExecutions).where(where).orderBy(desc(journeyExecutions.enrolledAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(journeyExecutions).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: JourneyExecutionInsert): Promise<void> {
  await tx.insert(journeyExecutions).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  currentStepIndex: number,
  currentVersion: number,
): Promise<boolean> {
  const set: Record<string, unknown> = {
    status,
    currentStepIndex,
    updatedAt: new Date(),
    version: sql`${journeyExecutions.version} + 1`,
  };
  if (status === "completed" || status === "exited") {
    set["completedAt"] = new Date();
  }

  const result = await tx
    .update(journeyExecutions)
    .set(set)
    .where(and(
      eq(journeyExecutions.id, id),
      eq(journeyExecutions.tenantId, tenantId),
      eq(journeyExecutions.version, currentVersion),
    ))
    .returning({ id: journeyExecutions.id });
  return result.length > 0;
}

/**
 * The one in-flight run for a (journey, profile) pair, read inside the caller's
 * transaction so the advance decision and the write it drives cannot straddle a
 * concurrent update. Terminal runs are excluded — a completed or exited run is
 * never advanced again. Backed by the partial unique index from migration 0003,
 * so at most one row can match.
 */
export async function findActiveForProfile(
  tx: ScopedTx,
  tenantId: string,
  journeyId: string,
  profileId: string,
): Promise<JourneyExecutionRow | null> {
  const rows = await tx
    .select()
    .from(journeyExecutions)
    .where(
      and(
        eq(journeyExecutions.tenantId, tenantId),
        eq(journeyExecutions.journeyId, journeyId),
        eq(journeyExecutions.profileId, profileId),
        inArray(journeyExecutions.status, ["enrolled", "in_progress"]),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
