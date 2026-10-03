import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { financeSettings, financeChangeRequests, type ChangeRequestRow } from "./schema.js";
import { SETTINGS_DEFAULTS, assertDebtHeadsValid, configuredDebtHeads, DomainError, type DebtGlHeads, type FinanceSettings } from "./domain.js";
import { financeHeads } from "../budget/schema.js";
import { effectiveHeadType } from "../budget/domain.js";

import type { Tx } from "./apply.js";

type Reader = Pick<Tx, "select">;

function toSettings(row: typeof financeSettings.$inferSelect | undefined): FinanceSettings {
  if (!row) return { ...SETTINGS_DEFAULTS };
  return {
    makerCheckerEnabled: row.makerCheckerEnabled,
    blockFyActivationOpenPeriods: row.blockFyActivationOpenPeriods,
    requireOpeningBalancesForActivation: row.requireOpeningBalancesForActivation,
    fyCreateAsDraft: row.fyCreateAsDraft,
    debtLoanLiabilityHeadId: row.debtLoanLiabilityHeadId ?? null,
    debtInterestExpenseHeadId: row.debtInterestExpenseHeadId ?? null,
    debtBankHeadId: row.debtBankHeadId ?? null,
  };
}

/** Settings inside an open transaction (consumers). Absent row = defaults. */
export async function loadSettingsTx(tx: Reader, tenantId: string): Promise<FinanceSettings> {
  const rows = await tx.select().from(financeSettings).where(eq(financeSettings.tenantId, tenantId)).limit(1);
  return toSettings(rows[0]);
}

/** Settings for a route (tenant-scoped read so RLS sees the GUC). */
export async function readSettings(tenantId: string): Promise<FinanceSettings & { updatedAt: string | null }> {
  const rows = await scopedRead((tx) => tx.select().from(financeSettings).where(eq(financeSettings.tenantId, tenantId)).limit(1));
  return { ...toSettings(rows[0]), updatedAt: rows[0]?.updatedAt?.toISOString() ?? null };
}

export async function listChangeRequests(
  tenantId: string,
  filter: { kind?: string | undefined; status?: string | undefined },
  limit: number,
  offset: number,
): Promise<{ rows: ChangeRequestRow[]; total: number }> {
  const where = and(
    eq(financeChangeRequests.tenantId, tenantId),
    filter.kind ? eq(financeChangeRequests.kind, filter.kind) : undefined,
    filter.status ? eq(financeChangeRequests.status, filter.status) : undefined,
  );
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(financeChangeRequests).where(where)
      .orderBy(desc(financeChangeRequests.requestedAt), desc(financeChangeRequests.id)).limit(limit).offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(financeChangeRequests).where(where);
    return { rows, total: c?.n ?? 0 };
  });
}

export async function findChangeRequest(tenantId: string, id: string): Promise<ChangeRequestRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeChangeRequests)
    .where(and(eq(financeChangeRequests.tenantId, tenantId), eq(financeChangeRequests.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function findPendingBySubject(tenantId: string, kind: string, subjectKey: string): Promise<ChangeRequestRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeChangeRequests)
    .where(and(
      eq(financeChangeRequests.tenantId, tenantId), eq(financeChangeRequests.kind, kind),
      eq(financeChangeRequests.subjectKey, subjectKey), eq(financeChangeRequests.status, "pending"),
    )).limit(1));
  return rows[0] ?? null;
}

/** Effective type and leaf-ness of each of the given tenant heads that exists (a head with children is not a leaf). */
export async function headTypesTx(tx: Reader, tenantId: string, ids: readonly string[]): Promise<Map<string, { type: string; leaf: boolean }>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.select({ id: financeHeads.id, code: financeHeads.code, classification: financeHeads.classification })
    .from(financeHeads).where(and(eq(financeHeads.tenantId, tenantId), inArray(financeHeads.id, [...ids])));
  const kids = await tx.select({ parentId: financeHeads.parentId }).from(financeHeads)
    .where(and(eq(financeHeads.tenantId, tenantId), inArray(financeHeads.parentId, [...ids])));
  const parents = new Set(kids.map((k) => k.parentId));
  return new Map(rows.map((h) => [h.id, { type: effectiveHeadType(h.classification, h.code), leaf: !parents.has(h.id) }]));
}

/**
 * The debt GL heads, validated. Throws DomainError GL_HEADS_NOT_CONFIGURED until all three are set
 * (there are no defaults), and GL_HEAD_NOT_FOUND / GL_HEAD_WRONG_TYPE / GL_HEAD_NOT_LEAF / GL_HEADS_CLASH when they are unusable.
 * `bankHeadId` overrides the tenant bank head for one posting (an office paying from several accounts); it is
 * validated exactly like the configured one.
 */
export async function requireDebtHeadsTx(tx: Reader, tenantId: string, opts: { bankHeadId?: string | null } = {}): Promise<DebtGlHeads> {
  const configured = configuredDebtHeads(await loadSettingsTx(tx, tenantId));
  if (!configured) throw new DomainError("GL_HEADS_NOT_CONFIGURED", "set the loan liability, interest expense and bank GL heads in Finance settings before recording debt");
  const heads = { ...configured, ...(opts.bankHeadId ? { bank: opts.bankHeadId } : {}) };
  assertDebtHeadsValid(heads, await headTypesTx(tx, tenantId, [heads.loanLiability, heads.interestExpense, heads.bank]));
  return heads;
}

export async function requireDebtHeads(tenantId: string, opts: { bankHeadId?: string | null } = {}): Promise<DebtGlHeads> {
  return scopedRead((tx) => requireDebtHeadsTx(tx, tenantId, opts));
}
