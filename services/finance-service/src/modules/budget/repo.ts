import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { DomainError } from "./domain.js";
import { financeBudgets, financeSanctions, financeHeads, financeReappropriations, type BudgetRow, type BudgetInsert, type SanctionRow, type SanctionInsert, type HeadRow, type ReappropriationRow, type ReappropriationInsert } from "./schema.js";

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

// ── re-appropriation request reads/writes (consumer only for writes) ─────────

export async function insertReappropriation(tx: Writer, row: ReappropriationInsert): Promise<void> {
  await tx.insert(financeReappropriations).values(row);
}

export async function updateReappropriation(tx: Writer, id: string, patch: Partial<ReappropriationInsert>): Promise<void> {
  await tx.update(financeReappropriations).set({ ...patch, updatedAt: new Date() }).where(eq(financeReappropriations.id, id));
}

export async function findReappropriationByIdTx(tx: Writer, id: string): Promise<ReappropriationRow | null> {
  const rows = await (tx as typeof db).select().from(financeReappropriations).where(eq(financeReappropriations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findReappropriationById(id: string): Promise<ReappropriationRow | null> {
  const rows = await db.select().from(financeReappropriations).where(eq(financeReappropriations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listHeads(tenantId: string, limit: number): Promise<HeadRow[]> {
  return db.select().from(financeHeads)
    .where(eq(financeHeads.tenantId, tenantId))
    .limit(limit);
}

export async function listSanctionsByTenant(tenantId: string, limit: number): Promise<SanctionRow[]> {
  return db.select().from(financeSanctions)
    .where(eq(financeSanctions.tenantId, tenantId))
    .limit(limit);
}

export async function listBudgetsByTenant(tenantId: string, limit: number): Promise<BudgetRow[]> {
  return db.select().from(financeBudgets)
    .where(eq(financeBudgets.tenantId, tenantId))
    .limit(limit);
}

export async function findHeadById(id: string): Promise<HeadRow | null> {
  const rows = await db.select().from(financeHeads).where(eq(financeHeads.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findHeadByIdTx(tx: Writer, id: string): Promise<HeadRow | null> {
  const rows = await (tx as typeof db).select().from(financeHeads).where(eq(financeHeads.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Resolve a head by its account code within the current tx (for GL posting). */
export async function findHeadByCodeTx(tx: Writer, tenantId: string, code: string): Promise<HeadRow | null> {
  const rows = await (tx as typeof db).select().from(financeHeads)
    .where(and(eq(financeHeads.tenantId, tenantId), eq(financeHeads.code, code)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateHead(tx: Writer, id: string, patch: Partial<HeadRow>): Promise<void> {
  await tx.update(financeHeads).set({ ...patch, updatedAt: new Date() }).where(eq(financeHeads.id, id));
}

/** Executor that can run raw SQL (drizzle db or tx). */
type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Atomic, race-safe sanction utilisation. Increments utilised_minor by net only
 * if balance remains (amount_minor - utilised_minor >= net). Returns true on
 * success, false when the sanction is exhausted (caller must reject the bill).
 * Avoids the read-then-set lost-update bug.
 */
export async function incrementSanctionUtilisedGuarded(tx: Exec, id: string, netMinor: bigint, updatedBy: string): Promise<boolean> {
  const rows = await tx.execute(sql`
    UPDATE budget.finance_sanctions
       SET utilised_minor = utilised_minor + ${netMinor}, updated_by = ${updatedBy}, updated_at = now()
     WHERE id = ${id}
       AND amount_minor - utilised_minor >= ${netMinor}
    RETURNING id
  `);
  return (rows as unknown as unknown[]).length > 0;
}

/**
 * R4 — zero-sum re-appropriation (GFR Rule 10). Atomically debits the source
 * budget's re_minor and credits the target budget's re_minor by the same
 * amount, conserving total appropriation. The source debit is guarded: it only
 * applies if the source still has enough savings (re_minor - utilised_minor >=
 * amount), so concurrent transfers cannot overdraw. Returns false (no change)
 * when the source has insufficient savings; throws when the target head does
 * not exist (rolls back the debit since both run in the caller's transaction).
 * Must be called inside a db.transaction so the two legs commit together.
 */
export async function transferBudgetReMinorGuarded(
  tx: Exec,
  fromId: string,
  toId: string,
  amountMinor: bigint,
  tenantId: string,
  updatedBy: string,
): Promise<boolean> {
  const debited = await tx.execute(sql`
    UPDATE budget.finance_budgets
       SET re_minor = re_minor - ${amountMinor}, updated_by = ${updatedBy}, updated_at = now()
     WHERE id = ${fromId} AND tenant_id = ${tenantId}
       AND re_minor - utilised_minor >= ${amountMinor}
    RETURNING id
  `);
  if ((debited as unknown as unknown[]).length === 0) return false; // insufficient savings / unknown source

  const credited = await tx.execute(sql`
    UPDATE budget.finance_budgets
       SET re_minor = re_minor + ${amountMinor}, updated_by = ${updatedBy}, updated_at = now()
     WHERE id = ${toId} AND tenant_id = ${tenantId}
    RETURNING id
  `);
  if ((credited as unknown as unknown[]).length === 0) {
    throw new DomainError("TARGET_NOT_FOUND", `re-appropriation target budget ${toId} not found for tenant`);
  }
  return true;
}
