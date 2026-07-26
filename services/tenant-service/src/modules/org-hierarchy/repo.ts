import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { orgUnits } from "./schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function listOrgUnits(tenantId: string): Promise<typeof orgUnits.$inferSelect[]> {
  return db.select().from(orgUnits).where(eq(orgUnits.tenantId, tenantId)).orderBy(orgUnits.level, orgUnits.name);
}

export async function findById(tenantId: string, id: string): Promise<typeof orgUnits.$inferSelect | undefined> {
  const rows = await db.select().from(orgUnits).where(and(eq(orgUnits.id, id), eq(orgUnits.tenantId, tenantId))).limit(1);
  return rows[0];
}

export async function findChildren(tenantId: string, parentId: string): Promise<typeof orgUnits.$inferSelect[]> {
  return db.select().from(orgUnits).where(and(eq(orgUnits.tenantId, tenantId), eq(orgUnits.parentId, parentId))).orderBy(orgUnits.name);
}

export async function findRoots(tenantId: string): Promise<typeof orgUnits.$inferSelect[]> {
  return db.select().from(orgUnits).where(and(eq(orgUnits.tenantId, tenantId), isNull(orgUnits.parentId))).orderBy(orgUnits.name);
}

export async function insertOrgUnit(tx: Tx, data: typeof orgUnits.$inferInsert): Promise<void> {
  await tx.insert(orgUnits).values(data);
}

export async function updateOrgUnit(tx: Tx, id: string, tenantId: string, data: Partial<Pick<typeof orgUnits.$inferSelect, "name" | "type" | "parentId" | "headUserId" | "code">>): Promise<void> {
  await tx.update(orgUnits).set({ ...data, updatedAt: new Date() }).where(and(eq(orgUnits.id, id), eq(orgUnits.tenantId, tenantId)));
}
