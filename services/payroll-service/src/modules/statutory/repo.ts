import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { payrollPf, payrollTds, payrollEsi, payrollGratuity, payrollGpf, payrollNps } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPf(tx: Writer, row: typeof payrollPf.$inferInsert): Promise<void> {
  await tx.insert(payrollPf).values(row);
}

export async function insertEsi(tx: Writer, row: typeof payrollEsi.$inferInsert): Promise<void> {
  await tx.insert(payrollEsi).values(row);
}

export async function insertTds(tx: Writer, row: typeof payrollTds.$inferInsert): Promise<void> {
  await tx.insert(payrollTds).values(row);
}

export async function insertGratuity(tx: Writer, row: typeof payrollGratuity.$inferInsert): Promise<void> {
  await tx.insert(payrollGratuity).values(row);
}

export async function insertGpf(tx: Writer, row: typeof payrollGpf.$inferInsert): Promise<void> {
  await tx.insert(payrollGpf).values(row);
}

export async function insertNps(tx: Writer, row: typeof payrollNps.$inferInsert): Promise<void> {
  await tx.insert(payrollNps).values(row);
}

export async function listPfByTenant(tenantId: string, limit = 100) {
  return db.select().from(payrollPf).where(eq(payrollPf.tenantId, tenantId)).limit(limit);
}

export async function listEsiByTenant(tenantId: string, limit = 100) {
  return db.select().from(payrollEsi).where(eq(payrollEsi.tenantId, tenantId)).limit(limit);
}

export async function listTdsByTenant(tenantId: string, limit = 100) {
  return db.select().from(payrollTds).where(eq(payrollTds.tenantId, tenantId)).limit(limit);
}

export async function listGratuityByTenant(tenantId: string, limit = 100) {
  return db.select().from(payrollGratuity).where(eq(payrollGratuity.tenantId, tenantId)).limit(limit);
}

export async function listGpfByTenant(tenantId: string, limit = 100) {
  return db.select().from(payrollGpf).where(eq(payrollGpf.tenantId, tenantId)).limit(limit);
}

export async function listNpsByTenant(tenantId: string, limit = 100) {
  return db.select().from(payrollNps).where(eq(payrollNps.tenantId, tenantId)).limit(limit);
}
