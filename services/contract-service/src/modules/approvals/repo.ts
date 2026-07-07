import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { approvalLevels, type ApprovalLevelRow, type ApprovalLevelInsert } from "./schema.js";

async function tenantRead<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as typeof db);
  });
}

export async function insertApprovalLevel(level: ApprovalLevelInsert): Promise<ApprovalLevelRow> {
  return tenantRead(level.tenantId, async (tx) => {
    const [row] = await tx.insert(approvalLevels).values(level).returning();
    return row!;
  });
}

export async function getApprovalLevelById(id: string, tenantId: string): Promise<ApprovalLevelRow | undefined> {
  return tenantRead(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(approvalLevels)
      .where(and(eq(approvalLevels.id, id), eq(approvalLevels.tenantId, tenantId)))
      .limit(1);
    return row;
  });
}

export async function listApprovalLevels(
  tenantId: string,
  opts: { limit: number; offset: number },
): Promise<{ data: ApprovalLevelRow[]; total: number }> {
  return tenantRead(tenantId, async (tx) => {
    const where = eq(approvalLevels.tenantId, tenantId);

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalLevels)
      .where(where);

    const data = await tx
      .select()
      .from(approvalLevels)
      .where(where)
      .orderBy(approvalLevels.minValuePaise)
      .limit(opts.limit)
      .offset(opts.offset);

    return { data, total: countResult?.count ?? 0 };
  });
}

export async function countApprovalLevels(tenantId: string): Promise<number> {
  return tenantRead(tenantId, async (tx) => {
    const [result] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalLevels)
      .where(eq(approvalLevels.tenantId, tenantId));
    return result?.count ?? 0;
  });
}

export async function updateApprovalLevel(
  id: string,
  tenantId: string,
  currentVersion: number,
  updates: Partial<Pick<ApprovalLevelRow, "minValuePaise" | "requiredRole" | "label" | "updatedBy">>,
): Promise<ApprovalLevelRow | null> {
  return tenantRead(tenantId, async (tx) => {
    const [row] = await tx
      .update(approvalLevels)
      .set({
        ...updates,
        version: currentVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(approvalLevels.id, id),
          eq(approvalLevels.tenantId, tenantId),
          eq(approvalLevels.version, currentVersion),
        ),
      )
      .returning();
    return row ?? null;
  });
}

export async function deleteApprovalLevel(id: string, tenantId: string): Promise<boolean> {
  return tenantRead(tenantId, async (tx) => {
    const result = await tx
      .delete(approvalLevels)
      .where(and(eq(approvalLevels.id, id), eq(approvalLevels.tenantId, tenantId)))
      .returning();
    return result.length > 0;
  });
}
