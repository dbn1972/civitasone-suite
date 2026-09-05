import { eq, and, inArray, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import { grantInstallments, grantDisbursements, grantPfmsRecords, type InstallmentRow, type InstallmentInsert, type DisbursementRow, type DisbursementInsert, type PfmsRecordInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findInstallmentById(id: string, tenantId: string): Promise<InstallmentRow | null> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(grantInstallments)
      .where(and(eq(grantInstallments.id, id), eq(grantInstallments.tenantId, tenantId))).limit(1);
    return rows[0] ?? null;
  }));
}

export async function findInstallmentByIdTx(tx: Writer, id: string, tenantId: string): Promise<InstallmentRow | null> {
  const rows = await (tx as typeof db).select().from(grantInstallments)
    .where(and(eq(grantInstallments.id, id), eq(grantInstallments.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findInstallmentsByApplication(applicationId: string, tenantId: string, limit = 500): Promise<InstallmentRow[]> {
  return runWithTenant(tenantId, () =>
    scopedRead(async (tx) =>
      tx.select().from(grantInstallments)
        .where(and(eq(grantInstallments.applicationId, applicationId), eq(grantInstallments.tenantId, tenantId)))
        .limit(limit)));
}

export async function findDisbursementsByApplicationId(applicationId: string, tenantId: string): Promise<DisbursementRow[]> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const installments = await tx.select().from(grantInstallments)
      .where(and(eq(grantInstallments.applicationId, applicationId), eq(grantInstallments.tenantId, tenantId)))
      .limit(500);
    if (!installments.length) return [];
    const ids = installments.map((i) => i.id);
    const all: DisbursementRow[] = [];
    for (const id of ids) {
      const rows = await tx.select().from(grantDisbursements).where(eq(grantDisbursements.installmentId, id)).limit(500);
      all.push(...rows);
    }
    return all;
  }));
}

export async function sumDisbursedForApplication(tx: Writer, applicationId: string, tenantId: string): Promise<bigint> {
  // P1-1: count only COMPLETED disbursements (post-EFT settlement), not the
  // optimistic installment status. A failed/initiated disbursement must NOT
  // inflate the approved/UC ceiling. Tenant-scoped (P1 isolation).
  // SC-1: uses SQL SUM() aggregates instead of fetching all rows — safe at
  // any data volume (no LIMIT on an aggregate that must be exact).
  const doQuery = async (q: Writer) => {
    const installmentSum = await (q as typeof db)
      .select({ total: sql<string>`coalesce(sum(${grantDisbursements.amountMinor}), 0)` })
      .from(grantDisbursements)
      .innerJoin(grantInstallments, eq(grantDisbursements.installmentId, grantInstallments.id))
      .where(and(
        eq(grantInstallments.applicationId, applicationId),
        eq(grantDisbursements.tenantId, tenantId),
        eq(grantInstallments.tenantId, tenantId),
        eq(grantDisbursements.status, "completed"),
      ));
    return BigInt(installmentSum[0]?.total ?? "0");
  };
  // If called with the top-level db (not inside an existing tx), wrap in
  // runWithTenant + scopedRead so the GUC is set for RLS.
  if (tx === db) {
    return runWithTenant(tenantId, () => scopedRead((stx) => doQuery(stx as unknown as Writer)));
  }
  return doQuery(tx);
}

export async function insertInstallment(tx: Writer, row: InstallmentInsert): Promise<void> {
  await tx.insert(grantInstallments).values(row);
}

export async function updateInstallment(tx: Writer, id: string, patch: Partial<InstallmentInsert>): Promise<void> {
  await tx.update(grantInstallments).set({ ...patch, updatedAt: new Date() }).where(eq(grantInstallments.id, id));
}

export async function insertDisbursement(tx: Writer, row: DisbursementInsert): Promise<void> {
  await tx.insert(grantDisbursements).values(row);
}

export async function updateDisbursement(tx: Writer, id: string, patch: Partial<DisbursementInsert>): Promise<void> {
  await tx.update(grantDisbursements).set({ ...patch, updatedAt: new Date() }).where(eq(grantDisbursements.id, id));
}

export async function findDisbursementByPfmsTxnId(pfmsTxnId: string, tenantId: string): Promise<DisbursementRow | null> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(grantDisbursements)
      .where(and(eq(grantDisbursements.pfmsTxnId, pfmsTxnId), eq(grantDisbursements.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  }));
}

/**
 * Tx-scoped variant of findDisbursementByPfmsTxnId: reads through the
 * caller'''s already-open transaction. pfmsReconcile
 * (disbursement/consumer.ts) calls this once PER RECORD in a reconciliation
 * batch from inside its own open db.transaction() -- the scopedRead-based
 * version there opens a SECOND transaction competing for a connection from
 * the same pool as the outer one, deadlocking every in-flight reconcile
 * batch once concurrency reaches pool.max (see
 * .claude/skills/16-production-readiness-audit.md section 1).
 */
export async function findDisbursementByPfmsTxnIdTx(tx: Writer, pfmsTxnId: string, tenantId: string): Promise<DisbursementRow | null> {
  const rows = await (tx as typeof db).select().from(grantDisbursements)
    .where(and(eq(grantDisbursements.pfmsTxnId, pfmsTxnId), eq(grantDisbursements.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findDisbursementByIdTx(tx: Writer, id: string, tenantId: string): Promise<DisbursementRow | null> {
  const rows = await (tx as typeof db).select().from(grantDisbursements)
    .where(and(eq(grantDisbursements.id, id), eq(grantDisbursements.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findDisbursementById(id: string, tenantId: string): Promise<DisbursementRow | null> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(grantDisbursements)
      .where(and(eq(grantDisbursements.id, id), eq(grantDisbursements.tenantId, tenantId))).limit(1);
    return rows[0] ?? null;
  }));
}

export async function insertPfmsRecord(tx: Writer, row: PfmsRecordInsert): Promise<void> {
  await tx.insert(grantPfmsRecords).values(row);
}

export async function markPfmsReconciled(tx: Writer, disbursementId: string): Promise<void> {
  await tx.update(grantPfmsRecords)
    .set({ reconciled: true, reconciledAt: new Date(), updatedAt: new Date() })
    .where(eq(grantPfmsRecords.disbursementId, disbursementId));
}

export async function listDisbursementsByTenant(tenantId: string, limit: number): Promise<DisbursementRow[]> {
  return runWithTenant(tenantId, () =>
    scopedRead(async (tx) =>
      tx.select().from(grantDisbursements)
        .where(eq(grantDisbursements.tenantId, tenantId))
        .limit(limit)));
}

export async function listInstallmentsByTenant(tenantId: string, limit = 200): Promise<InstallmentRow[]> {
  return runWithTenant(tenantId, () =>
    scopedRead(async (tx) =>
      tx.select().from(grantInstallments)
        .where(eq(grantInstallments.tenantId, tenantId))
        .limit(limit)));
}

/**
 * Chain #4: installments awaiting a specific project milestone that are eligible
 * for release. "Releasable" = milestone-linked AND not yet disbursed/initiated
 * (i.e. still `pending`). Tenant-scoped.
 * SC-1: capped at 200 — a milestone should never have more than a handful of
 * linked installments; 200 is a safe upper bound that prevents a full table
 * scan while never silently dropping legitimate records in practice.
 */
export async function findReleasableInstallmentsByMilestone(
  tx: Writer, milestoneId: string, tenantId: string,
): Promise<InstallmentRow[]> {
  return (tx as typeof db).select().from(grantInstallments)
    .where(and(
      eq(grantInstallments.milestoneId, milestoneId),
      eq(grantInstallments.tenantId, tenantId),
      eq(grantInstallments.status, "pending"),
    ))
    .limit(200);
}

/**
 * Resolve beneficiary bank details from a `beneficiaryBankRef` pointer
 * ("grant_bank_accounts:UUID") for a real (non-mock) PFMS submission.
 *
 * BUG FIX: this previously queried `disbursement.grant_bank_accounts`
 * (columns `beneficiary_name`, `account_no`) — a table/schema that has never
 * existed in any migration. The real table is `beneficiary.grant_bank_accounts`
 * (joined to `beneficiary.grant_beneficiaries` for the name), and by DPDP
 * design (see beneficiary/schema.ts) it only ever holds `account_no_masked`
 * (last 4 digits) — grant-service never stores a full account number anywhere.
 * In mock mode (the default, and what this environment runs) this function is
 * never called, so the bug was latent. The moment PFMS_MODE is sandbox/production
 * this would have thrown "relation does not exist", or — if some other table
 * happened to exist at that name — silently sent unvetted data to a real
 * government disbursement API.
 *
 * Returned `accountNoMasked` is NOT sufficient to actually route a bank
 * transfer; callers in real PFMS mode must fail closed rather than send a
 * masked/blank account number to PFMS (see disbursement/consumer.ts).
 * Resolving a genuine full account number for live PFMS submission requires a
 * dedicated, separately-secured KYC/bank vault this service intentionally does
 * not hold — that is a follow-up integration decision, not something to patch
 * over here.
 */
export async function findBeneficiaryByRef(
  tx: Writer, ref: string, tenantId: string,
): Promise<{ name: string; accountNoMasked: string; ifsc: string } | null> {
  const rows = await (tx as typeof db).execute(
    sql`SELECT gb.name AS name, ba.account_no_masked AS account_no_masked, ba.bank_ifsc AS ifsc
        FROM beneficiary.grant_bank_accounts ba
        JOIN beneficiary.grant_beneficiaries gb ON gb.id = ba.beneficiary_id AND gb.tenant_id = ba.tenant_id
        WHERE ba.id = ${ref}::uuid AND ba.tenant_id = ${tenantId}::uuid LIMIT 1`,
  ) as unknown as Array<{ name: string; account_no_masked: string; ifsc: string }>;
  const r = rows[0];
  return r ? { name: r.name, accountNoMasked: r.account_no_masked, ifsc: r.ifsc } : null;
}
