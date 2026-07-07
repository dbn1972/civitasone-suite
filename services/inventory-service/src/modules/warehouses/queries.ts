/**
 * warehouses module — read queries (tenant-scoped).
 */
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { warehouses } from "./schema.js";

export async function getWarehouse(tenantId: string, id: string) {
  const rows = await db.select().from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listWarehouses(tenantId: string, limit: number, offset: number) {
  return db.select().from(warehouses)
    .where(eq(warehouses.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
}
