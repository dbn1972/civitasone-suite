import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { grantBeneficiaries, grantBankAccounts, grantAadhaarLinks, type BeneficiaryRow, type BeneficiaryInsert, type BankAccountRow, type BankAccountInsert, type AadhaarLinkRow, type AadhaarLinkInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findBeneficiaryById(id: string): Promise<BeneficiaryRow | null> {
  const rows = await db.select().from(grantBeneficiaries).where(eq(grantBeneficiaries.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findAadhaarByBeneficiary(beneficiaryId: string): Promise<AadhaarLinkRow | null> {
  const rows = await db.select().from(grantAadhaarLinks).where(eq(grantAadhaarLinks.beneficiaryId, beneficiaryId)).limit(1);
  return rows[0] ?? null;
}

/**
 * DPDP §4 + de-duplication: lookup by SHA-256 token (never raw Aadhaar).
 * If a different beneficiary already has this token, reject seeding to prevent
 * duplicate registration of the same Aadhaar across the tenant.
 */
export async function findAadhaarByTokenAndTenant(tenantId: string, token: string): Promise<AadhaarLinkRow | null> {
  const rows = await db.select().from(grantAadhaarLinks)
    .where(and(eq(grantAadhaarLinks.tenantId, tenantId), eq(grantAadhaarLinks.aadhaarToken, token)))
    .limit(1);
  return rows[0] ?? null;
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
  return db.select().from(grantBeneficiaries)
    .where(eq(grantBeneficiaries.tenantId, tenantId))
    .limit(limit);
}
