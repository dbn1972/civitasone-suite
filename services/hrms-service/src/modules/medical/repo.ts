import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  hrmsMedicalClaims, type MedicalClaimRow, type MedicalClaimInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertClaim(tx: Writer, row: MedicalClaimInsert): Promise<void> {
  await tx.insert(hrmsMedicalClaims).values(row);
}

export async function findClaimById(id: string, tenantId: string): Promise<MedicalClaimRow | null> {
  const rows = await db.select().from(hrmsMedicalClaims)
    .where(and(eq(hrmsMedicalClaims.id, id), eq(hrmsMedicalClaims.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findClaimByIdTx(tx: Writer, id: string): Promise<MedicalClaimRow | null> {
  const rows = await tx.select().from(hrmsMedicalClaims)
    .where(eq(hrmsMedicalClaims.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateClaimStatus(
  tx: Writer,
  id: string,
  updates: Partial<MedicalClaimInsert>,
): Promise<void> {
  await tx.update(hrmsMedicalClaims)
    .set({ ...updates, version: sql`${hrmsMedicalClaims.version} + 1`, updatedAt: new Date() })
    .where(eq(hrmsMedicalClaims.id, id));
}

export async function listClaimsByEmployee(
  tenantId: string,
  employeeId: string,
  limit = 200,
): Promise<MedicalClaimRow[]> {
  return db.select().from(hrmsMedicalClaims)
    .where(and(
      eq(hrmsMedicalClaims.tenantId, tenantId),
      eq(hrmsMedicalClaims.employeeId, employeeId),
    ))
    .orderBy(desc(hrmsMedicalClaims.createdAt))
    .limit(limit);
}
