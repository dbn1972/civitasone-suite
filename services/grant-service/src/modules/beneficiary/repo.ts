import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import { grantBeneficiaries, grantBankAccounts, grantAadhaarLinks, type BeneficiaryRow, type BeneficiaryInsert, type BankAccountRow, type BankAccountInsert, type AadhaarLinkRow, type AadhaarLinkInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findBeneficiaryById(id: string, tenantId: string): Promise<BeneficiaryRow | null> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(grantBeneficiaries)
      .where(and(eq(grantBeneficiaries.id, id), eq(grantBeneficiaries.tenantId, tenantId))).limit(1);
    return rows[0] ?? null;
  }));
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
