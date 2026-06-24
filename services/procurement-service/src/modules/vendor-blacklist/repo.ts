import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { vendorBlacklist, type VendorBlacklistRow, type VendorBlacklistInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function listActiveByTenant(tenantId: string, limit = 50, offset = 0): Promise<VendorBlacklistRow[]> {
  return db.select().from(vendorBlacklist)
    .where(and(eq(vendorBlacklist.tenantId, tenantId), eq(vendorBlacklist.status, "active")))
    .limit(limit).offset(offset);
}

export async function findActive(tenantId: string, vendorId: string): Promise<VendorBlacklistRow | null> {
  const rows = await db.select().from(vendorBlacklist)
    .where(and(
      eq(vendorBlacklist.tenantId, tenantId),
      eq(vendorBlacklist.vendorId, vendorId),
      eq(vendorBlacklist.status, "active"),
    )).limit(1);
  return rows[0] ?? null;
}

/** Tenant-scoped active-blacklist check usable INSIDE a transaction. */
export async function isBlacklistedTx(tx: Writer, tenantId: string, vendorId: string): Promise<boolean> {
  const rows = await (tx as typeof db).select({ id: vendorBlacklist.id }).from(vendorBlacklist)
    .where(and(
      eq(vendorBlacklist.tenantId, tenantId),
      eq(vendorBlacklist.vendorId, vendorId),
      eq(vendorBlacklist.status, "active"),
    )).limit(1);
  return rows.length > 0;
}

export async function insertBlacklist(row: VendorBlacklistInsert): Promise<VendorBlacklistRow> {
  const rows = await db.insert(vendorBlacklist).values(row).returning();
  return rows[0]!;
}

/** Reinstate (soft-deactivate) the active blacklist row for a vendor. Returns affected rows. */
export async function reinstate(tenantId: string, vendorId: string, actorId: string): Promise<number> {
  const res = await db.execute(sql`
    UPDATE procurement.vendor_blacklist
       SET status = 'reinstated', reinstated_at = NOW()
     WHERE tenant_id = ${tenantId}::uuid
       AND vendor_id = ${vendorId}::uuid
       AND status = 'active'
  `);
  return (res as unknown as { count?: number }).count ?? (res as unknown as { length: number }).length ?? 0;
}
