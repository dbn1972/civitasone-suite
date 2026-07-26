import { eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { migrations, reconciliations } from "./schema.js";

export async function listMigrations(tenantId: string) {
  return db.select().from(migrations).where(eq(migrations.tenantId, tenantId)).orderBy(desc(migrations.createdAt)).limit(50);
}

export async function findMigration(tenantId: string, id: string) {
  const rows = await db.select().from(migrations).where(eq(migrations.id, id)).limit(1);
  return rows[0];
}

export async function listReconciliationBreaks(tenantId: string, reconId: string) {
  // In full implementation, breaks would be in a separate table
  const recon = await db.select().from(reconciliations).where(eq(reconciliations.id, reconId)).limit(1);
  return recon[0] ? { reconId, breakCount: recon[0].breakCount, breaks: [] } : null;
}
