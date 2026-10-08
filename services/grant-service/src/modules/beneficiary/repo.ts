import { eq, and, inArray, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import { grantBeneficiaries, grantBankAccounts, grantAadhaarLinks, grantBeneficiaryCounters, type BeneficiaryRow, type BeneficiaryInsert, type BankAccountRow, type BankAccountInsert, type AadhaarLinkRow, type AadhaarLinkInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findBeneficiaryById(id: string, tenantId: string): Promise<BeneficiaryRow | null> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(grantBeneficiaries)
      .where(and(eq(grantBeneficiaries.id, id), eq(grantBeneficiaries.tenantId, tenantId))).limit(1);
    return rows[0] ?? null;
  }));
}

/**
 * PERF-005 batch loader: fetches N beneficiaries in ONE query instead of one
 * query per id. See findApplicationsByIds (application/repo.ts) for the
 * calling pattern this exists to support.
 */
export async function findBeneficiariesByIds(ids: string[], tenantId: string): Promise<BeneficiaryRow[]> {
  if (ids.length === 0) return [];
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    return tx.select().from(grantBeneficiaries)
      .where(and(inArray(grantBeneficiaries.id, ids), eq(grantBeneficiaries.tenantId, tenantId)));
  }));
}

/**
 * Tx-scoped variant of findBeneficiaryById: reads through the caller'''s
 * already-open transaction instead of opening a nested one via scopedRead.
 * applicationApprove (application/consumer.ts) calls this from inside its
 * own db.transaction() -- the scopedRead-based version there opens a
 * SECOND transaction competing for a connection from the same pool as the
 * outer one, deadlocking every in-flight command once concurrency reaches
 * pool.max (see .claude/skills/16-production-readiness-audit.md section 1).
 */
export async function findBeneficiaryByIdTx(tx: Writer, id: string, tenantId: string): Promise<BeneficiaryRow | null> {
  const rows = await (tx as typeof db).select().from(grantBeneficiaries)
    .where(and(eq(grantBeneficiaries.id, id), eq(grantBeneficiaries.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findAadhaarByBeneficiary(beneficiaryId: string, tenantId: string): Promise<AadhaarLinkRow | null> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(grantAadhaarLinks).where(eq(grantAadhaarLinks.beneficiaryId, beneficiaryId)).limit(1);
    return rows[0] ?? null;
  }));
}

/**
 * DPDP §4 + de-duplication: lookup by SHA-256 token (never raw Aadhaar).
 * If a different beneficiary already has this token, reject seeding to prevent
 * duplicate registration of the same Aadhaar across the tenant.
 */
export async function findAadhaarByTokenAndTenant(tenantId: string, token: string): Promise<AadhaarLinkRow | null> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(grantAadhaarLinks)
      .where(and(eq(grantAadhaarLinks.tenantId, tenantId), eq(grantAadhaarLinks.aadhaarToken, token)))
      .limit(1);
    return rows[0] ?? null;
  }));
}

export async function insertBeneficiary(tx: Writer, row: BeneficiaryInsert): Promise<void> {
  await tx.insert(grantBeneficiaries).values(row);
}

export async function insertBankAccount(tx: Writer, row: BankAccountInsert): Promise<void> {
  await tx.insert(grantBankAccounts).values(row);
}

export async function insertAadhaarLink(tx: Writer, row: AadhaarLinkInsert): Promise<void> {
  await tx.insert(grantAadhaarLinks).values(row);
}

export async function updateBankAccount(tx: Writer, id: string, patch: Partial<BankAccountInsert>): Promise<void> {
  await tx.update(grantBankAccounts).set({ ...patch, updatedAt: new Date() }).where(eq(grantBankAccounts.id, id));
}

export async function listBeneficiariesByTenant(tenantId: string, limit: number): Promise<BeneficiaryRow[]> {
  return runWithTenant(tenantId, () =>
    scopedRead(async (tx) =>
      tx.select().from(grantBeneficiaries)
        .where(eq(grantBeneficiaries.tenantId, tenantId))
        .limit(limit)));
}

/**
 * GAP2-GRANTS-GRANTEES-07: allocate the next gapless per-tenant grantee code
 * (GR-NNNNN) inside the caller's transaction. Mirrors
 * application/repo.ts::allocateSanctionNo — a rolled-back insert releases the
 * number, so there are no gaps or collisions.
 */
export async function allocateGranteeCode(tx: Writer, tenantId: string): Promise<string> {
  const rows = await (tx as typeof db)
    .insert(grantBeneficiaryCounters)
    .values({ tenantId, nextVal: 2n })
    .onConflictDoUpdate({
      target: [grantBeneficiaryCounters.tenantId],
      set: { nextVal: sql`${grantBeneficiaryCounters.nextVal} + 1` },
    })
    .returning({ nextVal: grantBeneficiaryCounters.nextVal });
  const stored = rows[0]!.nextVal;
  const allocated = stored - 1n;
  return `GR-${allocated.toString().padStart(5, "0")}`;
}

export type GranteePortfolioMetrics = {
  activeGrants: number;
  totalGrantsReceivedMinor: bigint;
  ucDue: number;
  ucValidated: number;
};

/**
 * GAP2-GRANTS-GRANTEES-06: compute REAL per-grantee portfolio metrics
 * (replacing the hard-coded 0/0/0 the API used to emit). For each beneficiary
 * in `ids`:
 *   - activeGrants              = count of APPROVED applications
 *   - totalGrantsReceivedMinor  = sum of COMPLETED disbursements (paise)
 *   - ucDue / ucValidated       = UC statements raised vs validated (compliance)
 * All queries are same-service, tenant-scoped. Beneficiaries with no grants are
 * simply absent from the returned Map; the caller defaults them to zeros (an
 * honest "nothing yet", not a fabricated figure for a grantee that HAS grants).
 */
export async function listGranteePortfolio(
  ids: string[], tenantId: string,
): Promise<Map<string, GranteePortfolioMetrics>> {
  const out = new Map<string, GranteePortfolioMetrics>();
  if (ids.length === 0) return out;
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    // approved applications per beneficiary + total disbursed (completed) + UC counts
    const rows = await (tx as typeof db).execute(sql`
      SELECT a.beneficiary_id AS beneficiary_id,
             COUNT(DISTINCT CASE WHEN a.status = 'approved' THEN a.id END) AS active_grants,
             COALESCE(SUM(CASE WHEN d.status = 'completed' THEN d.amount_minor ELSE 0 END), 0) AS total_received_minor,
             COUNT(DISTINCT u.id) AS uc_due,
             COUNT(DISTINCT CASE WHEN u.validation_status = 'validated' THEN u.id END) AS uc_validated
      FROM application.grant_applications a
      LEFT JOIN disbursement.grant_installments i
        ON i.application_id = a.id AND i.tenant_id = a.tenant_id
      LEFT JOIN disbursement.grant_disbursements d
        ON d.installment_id = i.id AND d.tenant_id = a.tenant_id
      LEFT JOIN utilisation.grant_uc_statements u
        ON u.application_id = a.id AND u.tenant_id = a.tenant_id
      WHERE a.tenant_id = ${tenantId}::uuid
        AND a.beneficiary_id IN (${idList})
      GROUP BY a.beneficiary_id
    `) as unknown as Array<{
      beneficiary_id: string;
      active_grants: number | string;
      total_received_minor: number | string;
      uc_due: number | string;
      uc_validated: number | string;
    }>;
    for (const r of rows) {
      out.set(r.beneficiary_id, {
        activeGrants: Number(r.active_grants),
        totalGrantsReceivedMinor: BigInt(r.total_received_minor),
        ucDue: Number(r.uc_due),
        ucValidated: Number(r.uc_validated),
      });
    }
    return out;
  }));
}
