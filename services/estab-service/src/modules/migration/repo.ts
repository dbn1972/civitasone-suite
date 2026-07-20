import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabMigrationRegister } from "./schema.js";
import type { MigrationRow, MigrationInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function findMigrationById(id: string, tenantId: string): Promise<MigrationRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(estabMigrationRegister)
    .where(and(eq(estabMigrationRegister.id, id), eq(estabMigrationRegister.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listMigrations(tenantId: string, limit: number): Promise<MigrationRow[]> {
  return db.transaction((tx) => tx.select().from(estabMigrationRegister)
    .where(eq(estabMigrationRegister.tenantId, tenantId))
    .orderBy(desc(estabMigrationRegister.createdAt))
    .limit(limit));
}

export async function insertMigration(tx: Writer, row: MigrationInsert): Promise<void> {
  await tx.insert(estabMigrationRegister).values(row);
}

export async function updateMigration(tx: Writer, id: string, patch: Partial<MigrationInsert>): Promise<void> {
  await tx.update(estabMigrationRegister).set({ ...patch, updatedAt: new Date() }).where(eq(estabMigrationRegister.id, id));
}
