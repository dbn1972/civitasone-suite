import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financeBudgets, financeSanctions, financeHeads, type BudgetRow, type BudgetInsert, type SanctionRow, type SanctionInsert, type HeadRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── budget reads ──────────────────────────────────────────────────

export async function findBudget(headId: string, fy: string, tenantId: string): Promise<BudgetRow | null> {
  const rows = await db.select().from(financeBudgets)
    .where(and(eq(financeBudgets.tenantId, tenantId), eq(financeBudgets.headId, headId), eq(financeBudgets.fy, fy)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findBudgetById(id: string): Promise<BudgetRow | null> {
  const rows = await db.select().from(financeBudgets).where(eq(financeBudgets.id, id)).limit(1);
  return rows[0] ?? null;
}

// ── sanction reads ────────────────────────────────────────────────

export async function findSanctionById(id: string): Promise<SanctionRow | null> {
  const rows = await db.select().from(financeSanctions).where(eq(financeSanctions.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Sum of net_minor from bills against a sanction (cross-module via raw SQL aggregate). */
export async function sanctionUtilised(tx: Writer, sanctionId: string): Promise<bigint> {
  // Bills live in the payments schema — we access them via the shared db connection
  // but only query by opaque ID (no FK, no join across module schemas).
  // The payments consumer maintains utilisedMinor on the sanction row, so we read it directly.
  const rows = await (tx as typeof db).select().from(financeSanctions).where(eq(financeSanctions.id, sanctionId)).limit(1);
  return rows[0]?.utilisedMinor ?? 0n;
}

// ── budget writes (consumer only) ────────────────────────────────

export async function insertBudget(tx: Writer, row: BudgetInsert): Promise<void> {
  await tx.insert(financeBudgets).values(row);
}

export async function updateBudget(tx: Writer, id: string, patch: Partial<BudgetInsert>): Promise<void> {
  await tx.update(financeBudgets).set({ ...patch, updatedAt: new Date() }).where(eq(financeBudgets.id, id));
}

// ── sanction writes (consumer only) ──────────────────────────────

export async function insertSanction(tx: Writer, row: SanctionInsert): Promise<void> {
  await tx.insert(financeSanctions).values(row);
}

export async function updateSanction(tx: Writer, id: string, patch: Partial<SanctionInsert>): Promise<void> {
  await tx.update(financeSanctions).set({ ...patch, updatedAt: new Date() }).where(eq(financeSanctions.id, id));
}

export async function findSanctionByIdTx(tx: Writer, id: string): Promise<SanctionRow | null> {
  const rows = await (tx as typeof db).select().from(financeSanctions).where(eq(financeSanctions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listHeads(tenantId: string, limit: number): Promise<HeadRow[]> {
  return db.select().from(financeHeads)
    .where(eq(financeHeads.tenantId, tenantId))
    .limit(limit);
}
