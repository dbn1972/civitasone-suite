import { eq, and, count, desc } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import {
  grantUcStatements, grantComplianceReports, grantUcValidations,
  type UcRow, type UcInsert, type UcValidationInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertUcStatement(tx: Writer, row: UcInsert): Promise<void> {
  await tx.insert(grantUcStatements).values(row);
}

export async function listUcByApplication(applicationId: string, tenantId: string, limit = 500): Promise<UcRow[]> {
  return runWithTenant(tenantId, () =>
    scopedRead(async (tx) =>
      tx.select().from(grantUcStatements)
        .where(and(eq(grantUcStatements.applicationId, applicationId), eq(grantUcStatements.tenantId, tenantId)))
        .limit(limit)));
}

export async function listUcByTenant(tenantId: string, limit: number): Promise<UcRow[]> {
  return runWithTenant(tenantId, () =>
    scopedRead(async (tx) =>
      tx.select().from(grantUcStatements)
        .where(eq(grantUcStatements.tenantId, tenantId))
        .limit(limit)));
}

/**
 * PFMS next-tranche gate (P0-3). Tranche N may only be released once the UC for
 * the SPECIFIC prior tranche (installment_no = N-1) has been submitted AND
 * validated, scoped to the tenant. A rejected/pending UC, a UC for a different
 * tranche, or a UC belonging to another tenant does NOT unlock tranche N.
 */
export async function hasSubmittedUcForApplication(
  applicationId: string,
  tenantId: string,
  installmentNo = 2,
): Promise<boolean> {
  if (installmentNo <= 1) return true;
  const priorTranche = installmentNo - 1;
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx
      .select({ cnt: count() })
      .from(grantUcStatements)
      .where(and(
        eq(grantUcStatements.tenantId, tenantId),
        eq(grantUcStatements.applicationId, applicationId),
        eq(grantUcStatements.installmentNo, priorTranche),
        eq(grantUcStatements.validationStatus, "validated"),
      ));
    return (rows[0]?.cnt ?? 0) >= 1;
  }));
}

/**
 * Tx-scoped variant of hasSubmittedUcForApplication: reads through the
 * caller'''s already-open transaction. disbursementInitiate
 * (disbursement/consumer.ts) enforces the PFMS utilisation-certificate gate
 * from inside its own db.transaction() -- the scopedRead-based version
 * there opens a SECOND transaction competing for a connection from the
 * same pool as the outer one, deadlocking every in-flight disbursement
 * once concurrency reaches pool.max (see
 * .claude/skills/16-production-readiness-audit.md section 1).
 */
export async function hasSubmittedUcForApplicationTx(
  tx: Writer,
  applicationId: string,
  tenantId: string,
  installmentNo = 2,
): Promise<boolean> {
  if (installmentNo <= 1) return true;
  const priorTranche = installmentNo - 1;
  const rows = await (tx as typeof db)
    .select({ cnt: count() })
    .from(grantUcStatements)
    .where(and(
      eq(grantUcStatements.tenantId, tenantId),
      eq(grantUcStatements.applicationId, applicationId),
      eq(grantUcStatements.installmentNo, priorTranche),
      eq(grantUcStatements.validationStatus, "validated"),
    ));
  return (rows[0]?.cnt ?? 0) >= 1;
}

/** Fetch a single UC statement scoped to tenant (for validation decisions). */
export async function findUcById(ucId: string, tenantId: string): Promise<UcRow | null> {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(grantUcStatements)
      .where(and(eq(grantUcStatements.id, ucId), eq(grantUcStatements.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  }));
}

/** Same as {@link findUcById} but reuses an existing transaction handle
 *  (for consumer defence-in-depth checks that must see the SoD guard inside
 *  the same transaction that performs the write). */
export async function findUcByIdTx(tx: Writer, ucId: string, tenantId: string): Promise<UcRow | null> {
  const rows = await (tx as typeof db).select().from(grantUcStatements)
    .where(and(eq(grantUcStatements.id, ucId), eq(grantUcStatements.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Persist a UC validation decision row (utilisation.grant_uc_validations). */
export async function insertUcValidation(tx: Writer, row: UcValidationInsert): Promise<void> {
  await tx.insert(grantUcValidations).values(row);
}

/** Set validation_status (+ validator metadata) on a UC statement, tenant-scoped. */
export async function setUcValidationStatus(
  tx: Writer,
  ucId: string,
  tenantId: string,
  status: "validated" | "rejected",
  validatedBy: string,
  remarks: string | null,
): Promise<void> {
  await tx.update(grantUcStatements)
    .set({
      validationStatus: status,
      validatedBy,
      validatedAt: new Date(),
      validationRemarks: remarks,
      updatedAt: new Date(),
      updatedBy: validatedBy,
    })
    .where(and(eq(grantUcStatements.id, ucId), eq(grantUcStatements.tenantId, tenantId)));
}

/** Latest validation decision for a UC (tenant-scoped), or null. */
export async function findLatestUcValidation(ucId: string, tenantId: string) {
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const rows = await tx.select().from(grantUcValidations)
      .where(and(eq(grantUcValidations.ucId, ucId), eq(grantUcValidations.tenantId, tenantId)))
      .orderBy(desc(grantUcValidations.validatedAt))
      .limit(1);
    return rows[0] ?? null;
  }));
}

export async function insertComplianceReport(tx: Writer, row: typeof grantComplianceReports.$inferInsert): Promise<void> {
  await tx.insert(grantComplianceReports).values(row);
}
