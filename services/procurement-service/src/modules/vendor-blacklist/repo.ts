import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { vendorBlacklist, type VendorBlacklistRow, type VendorBlacklistInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function listActiveByTenant(tenantId: string, limit = 50, offset = 0): Promise<VendorBlacklistRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(vendorBlacklist)
    .where(and(eq(vendorBlacklist.tenantId, tenantId), eq(vendorBlacklist.status, "active")))
    .limit(limit).offset(offset));
}

export async function findActive(tenantId: string, vendorId: string): Promise<VendorBlacklistRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(vendorBlacklist)
    .where(and(
      eq(vendorBlacklist.tenantId, tenantId),
      eq(vendorBlacklist.vendorId, vendorId),
      eq(vendorBlacklist.status, "active"),
    )).limit(1));
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

/**
 * R17 — federated (CVC/government-wide) debarment check. A vendor whose PAN
 * appears in an ACTIVE central debarment is blocked in EVERY tenant, regardless
 * of which authority recorded it. Case-insensitive PAN match. Usable inside a tx.
 */
export async function isCentrallyDebarredTx(tx: Writer, pan: string | null | undefined): Promise<boolean> {
  if (!pan) return false;
  const rows = await (tx as typeof db).select({ id: vendorBlacklist.id }).from(vendorBlacklist)
    .where(and(
      eq(vendorBlacklist.scope, "central"),
      eq(vendorBlacklist.status, "active"),
      sql`upper(${vendorBlacklist.pan}) = upper(${pan})`,
    )).limit(1);
  return rows.length > 0;
}

/** List active central (government-wide) debarments — visible to every tenant. */
export async function listActiveCentral(limit = 50, offset = 0): Promise<VendorBlacklistRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(vendorBlacklist)
    .where(and(eq(vendorBlacklist.scope, "central"), eq(vendorBlacklist.status, "active")))
    .limit(limit).offset(offset));
}

export async function findActiveCentralByPan(pan: string): Promise<VendorBlacklistRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(vendorBlacklist)
    .where(and(
      eq(vendorBlacklist.scope, "central"),
      eq(vendorBlacklist.status, "active"),
      sql`upper(${vendorBlacklist.pan}) = upper(${pan})`,
    )).limit(1));
  return rows[0] ?? null;
}

export async function insertBlacklist(
  row: VendorBlacklistInsert,
  writer?: Writer,
): Promise<VendorBlacklistRow> {
  // When called inside a consumer transaction, reuse that writer so markProcessed
  // and the insert share one GUC/tx. Otherwise wrap for standalone callers.
  if (writer) {
    const rows = await (writer as typeof db).insert(vendorBlacklist).values(row).returning();
    return rows[0]!;
  }
  const rows = await db.transaction((tx) => tx.insert(vendorBlacklist).values(row).returning());
  return rows[0]!;
}

/**
 * Reinstate (soft-deactivate) the active blacklist row for a vendor, through
 * the caller's already-open transaction.
 *
 * TX-002 fix: the previous `reinstate()` ran a bare `db.execute` with no
 * `db.transaction()` wrapper of its own. `wrapWithTenantGuc` only
 * intercepts `.transaction()` calls (packages/db/src/wrap-tenant-db.ts), so
 * that bare execute checked out a connection with `app.tenant_id` never
 * set. Under this table's FORCE ROW LEVEL SECURITY, `current_tenant_id()`
 * was NULL and the UPDATE silently matched 0 rows -- while the caller's
 * outer transaction (vendor-blacklist/consumer.ts) still flipped the
 * vendor's status to `registered`, enqueued `procurement.vendor.reinstated`,
 * and audited success. See docs/TX-012-test-role-rls-posture.md for the live
 * PoC that reproduced this exact split-brain state.
 *
 * Fix: take the caller's `tx` (the same connection the outer
 * `db.transaction()` already ran `SET LOCAL app.tenant_id` on) instead of
 * touching the bare `db` object, and assert exactly one row was affected --
 * throwing instead of silently reporting success on a 0-row match (e.g.
 * reinstating a vendor that was never actively blacklisted).
 */
export async function reinstateTx(
  tx: Writer,
  tenantId: string,
  vendorId: string,
  actorId: string,
): Promise<number> {
  void actorId; // not persisted on this row (matches prior reinstate() behavior); kept for call-site/audit symmetry
  const rows = await (tx as typeof db).update(vendorBlacklist)
    .set({ status: "reinstated", reinstatedAt: new Date() })
    .where(and(
      eq(vendorBlacklist.tenantId, tenantId),
      eq(vendorBlacklist.vendorId, vendorId),
      eq(vendorBlacklist.status, "active"),
    ))
    .returning({ id: vendorBlacklist.id });

  const affected = rows.length;
  if (affected !== 1) {
    throw new Error(
      `reinstateTx: expected exactly 1 active blacklist row for vendor ${vendorId} (tenant ${tenantId}), matched ${affected}`,
    );
  }
  return affected;
}
