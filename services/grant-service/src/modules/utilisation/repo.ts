import { eq } from "drizzle-orm";
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

export async function insertComplianceReport(tx: Writer, row: typeof grantComplianceReports.$inferInsert): Promise<void> {
  await tx.insert(grantComplianceReports).values(row);
}
