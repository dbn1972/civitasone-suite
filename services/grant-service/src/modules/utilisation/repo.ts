import { eq, and, count, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  grantUcStatements, grantComplianceReports,
  type UcRow, type UcInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertUcStatement(tx: Writer, row: UcInsert): Promise<void> {
  await tx.insert(grantUcStatements).values(row);
}

export async function listUcByApplication(applicationId: string): Promise<UcRow[]> {
  return db.select().from(grantUcStatements).where(eq(grantUcStatements.applicationId, applicationId));
}

export async function listUcByTenant(tenantId: string, limit: number): Promise<UcRow[]> {
  return db.select().from(grantUcStatements)
    .where(eq(grantUcStatements.tenantId, tenantId))
    .limit(limit);
}

/**
 * PFMS critical rule: tranche N+1 cannot be released unless UC for prior tranches
 * has been submitted/accepted. Requires at least (installmentNo - 1) UC records.
 */
export async function hasSubmittedUcForApplication(
  applicationId: string,
  installmentNo = 2,
): Promise<boolean> {
  if (installmentNo <= 1) return true;
  const required = installmentNo - 1;
  const rows = await db
    .select({ cnt: count() })
    .from(grantUcStatements)
    .where(and(
      eq(grantUcStatements.applicationId, applicationId),
      inArray(grantUcStatements.status, ["submitted", "accepted"]),
    ));
  return (rows[0]?.cnt ?? 0) >= required;
}

export async function insertComplianceReport(tx: Writer, row: typeof grantComplianceReports.$inferInsert): Promise<void> {
  await tx.insert(grantComplianceReports).values(row);
}
