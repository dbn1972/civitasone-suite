import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  projectPhysicalProgress, projectFinancialProgress, projectDprs,
  type PhysicalProgressInsert, type DprInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPhysicalProgress(tx: Writer, row: PhysicalProgressInsert): Promise<void> {
  await tx.insert(projectPhysicalProgress).values(row);
}

export async function listPhysicalProgressByProject(projectId: string, tenantId: string, limit = 500): Promise<(typeof projectPhysicalProgress.$inferSelect)[]> {
  return db.select().from(projectPhysicalProgress)
    .where(and(eq(projectPhysicalProgress.projectId, projectId), eq(projectPhysicalProgress.tenantId, tenantId)))
    .orderBy(desc(projectPhysicalProgress.periodDate))
    .limit(limit);
}

export async function insertFinancialProgress(tx: Writer, row: typeof projectFinancialProgress.$inferInsert): Promise<void> {
  await tx.insert(projectFinancialProgress).values(row);
}

export async function listFinancialProgressByProject(projectId: string, tenantId: string, limit = 500): Promise<(typeof projectFinancialProgress.$inferSelect)[]> {
  return db.select().from(projectFinancialProgress)
    .where(and(eq(projectFinancialProgress.projectId, projectId), eq(projectFinancialProgress.tenantId, tenantId)))
    .orderBy(desc(projectFinancialProgress.periodDate))
    .limit(limit);
}

export async function findDprByProjectAndDate(projectId: string, dprDate: string, tenantId: string): Promise<(typeof projectDprs.$inferSelect) | null> {
  const rows = await db.select().from(projectDprs)
    .where(and(
      eq(projectDprs.projectId, projectId),
      eq(projectDprs.dprDate, dprDate),
      eq(projectDprs.tenantId, tenantId),
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertDpr(tx: Writer, row: DprInsert): Promise<void> {
  await tx.insert(projectDprs).values(row);
}

export async function listDprsByProject(projectId: string, tenantId: string, limit = 500): Promise<(typeof projectDprs.$inferSelect)[]> {
  return db.select().from(projectDprs)
    .where(and(eq(projectDprs.projectId, projectId), eq(projectDprs.tenantId, tenantId)))
    .orderBy(desc(projectDprs.dprDate))
    .limit(limit);
}

// P0-1 aggregation helpers (run inside the recording tx).

// Latest cumulative physical % for a project (by most recent period, then most recent insert).
export async function latestCumulativePctTx(tx: Writer, projectId: string, tenantId: string): Promise<string | null> {
  const rows = await (tx as typeof db).select({ cumulativePct: projectPhysicalProgress.cumulativePct })
    .from(projectPhysicalProgress)
    .where(and(eq(projectPhysicalProgress.projectId, projectId), eq(projectPhysicalProgress.tenantId, tenantId)))
    .orderBy(desc(projectPhysicalProgress.periodDate), desc(projectPhysicalProgress.createdAt))
    .limit(1);
  return rows[0]?.cumulativePct ?? null;
}

// Total expenditure (paise) for a project — bigint sum, no Number() coercion.
export async function totalExpenditureMinorTx(tx: Writer, projectId: string, tenantId: string): Promise<bigint> {
  const rows = await (tx as typeof db).select({
    total: sql<string>`coalesce(sum(${projectFinancialProgress.expenditureMinor}), 0)::text`,
  })
    .from(projectFinancialProgress)
    .where(and(eq(projectFinancialProgress.projectId, projectId), eq(projectFinancialProgress.tenantId, tenantId)));
  return BigInt(rows[0]?.total ?? "0");
}
