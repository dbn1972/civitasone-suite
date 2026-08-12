import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { vendorRenewals, type VendorRenewalRow, type VendorRenewalInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<VendorRenewalRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(vendorRenewals)
      .where(and(eq(vendorRenewals.id, id), eq(vendorRenewals.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByLicence(licenceId: string, tenantId: string): Promise<VendorRenewalRow[]> {
  return scopedRead((tx) =>
    tx.select().from(vendorRenewals)
      .where(and(
        eq(vendorRenewals.tenantId, tenantId),
        eq(vendorRenewals.licenceId, licenceId),
      ))
      .orderBy(desc(vendorRenewals.createdAt)),
  );
}

export async function insertRenewal(tx: ScopedTx, row: VendorRenewalInsert): Promise<void> {
  await tx.insert(vendorRenewals).values(row);
}

export async function updateDecision(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  decidedBy: string,
  reason: string | null,
  newValidUntil: Date | null,
): Promise<boolean> {
  const result = await tx.update(vendorRenewals)
    .set({
      status,
      decidedBy,
      decidedAt: new Date(),
      decisionReason: reason,
      newValidUntil,
      updatedBy: decidedBy,
      updatedAt: new Date(),
      version: sql`${vendorRenewals.version} + 1`,
    })
    .where(and(eq(vendorRenewals.id, id), eq(vendorRenewals.tenantId, tenantId)))
    .returning({ id: vendorRenewals.id });
  return result.length > 0;
}
