import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementPos, procurementPoItems, type PoRow, type PoInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
/** Executor surface for raw guarded SQL (FOR UPDATE row lock). */
type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

export async function findPoById(id: string, tenantId: string): Promise<PoRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(procurementPos)
    .where(and(eq(procurementPos.id, id), eq(procurementPos.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findPoItemsByPoId(poId: string, tenantId: string): Promise<(typeof procurementPoItems.$inferSelect)[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementPoItems)
    .where(and(eq(procurementPoItems.poId, poId), eq(procurementPoItems.tenantId, tenantId))));
}

export async function findPoByIdTx(tx: Writer, id: string, tenantId: string): Promise<PoRow | null> {
  const rows = await (tx as typeof db).select().from(procurementPos)
    .where(and(eq(procurementPos.id, id), eq(procurementPos.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/**
 * Read a PO row under a FOR UPDATE row lock so concurrent amendment approvals
 * serialise on this row and can never both derive a new total from the same
 * pre-image (lost update). Caller MUST run inside a transaction. Tenant-scoped:
 * a foreign tenant id/tenant pair matches no row. Mirrors treasury's
 * findDepositByIdForUpdateTx raw-SQL FOR UPDATE pattern.
 */
export async function lockPoByIdTx(tx: Writer, id: string, tenantId: string): Promise<PoRow | null> {
  const res = await (tx as unknown as Executor).execute(sql`
    SELECT * FROM po.procurement_pos WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `);
  const rows = (res as { rows?: unknown[] }).rows ?? (res as unknown[]);
  const arr = rows as Array<Record<string, unknown>>;
  if (!arr[0]) return null;
  const r = arr[0];
  // Map snake_case raw columns onto the drizzle PoRow shape used by callers.
  return {
    id: r.id, tenantId: r.tenant_id, poNo: r.po_no, vendorId: r.vendor_id,
    indentRef: r.indent_ref, sanctionRef: r.sanction_ref, rateContractRef: r.rate_contract_ref,
    gemOrderNo: r.gem_order_no, orderType: r.order_type,
    totalMinor: BigInt((r.total_minor as string) ?? "0"),
    currency: r.currency, status: r.status, deliveryDate: r.delivery_date,
    createdAt: r.created_at, updatedAt: r.updated_at,
    createdBy: r.created_by, updatedBy: r.updated_by, version: Number(r.version),
  } as unknown as PoRow;
}

export async function listPosByTenant(tenantId: string, limit = 100, offset = 0): Promise<PoRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementPos).where(eq(procurementPos.tenantId, tenantId)).limit(limit).offset(offset));
}

export async function insertPo(tx: Writer, row: PoInsert): Promise<void> {
  await tx.insert(procurementPos).values(row);
}

export async function updatePo(tx: Writer, id: string, patch: Partial<PoInsert>): Promise<void> {
  await tx.update(procurementPos).set({ ...patch, updatedAt: new Date() }).where(eq(procurementPos.id, id));
}

/** Optimistic-locked update (#16): bumps version, fails if `expectedVersion` is stale. */
export async function updatePoVersioned(tx: Writer, id: string, expectedVersion: number, patch: Partial<PoInsert>): Promise<void> {
  const res = await (tx as typeof db).update(procurementPos)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(procurementPos.id, id), eq(procurementPos.version, expectedVersion)))
    .returning({ id: procurementPos.id });
  if (res.length === 0) {
    throw new Error(`OPTIMISTIC_LOCK_CONFLICT: po ${id} was modified concurrently (expected version ${expectedVersion})`);
  }
}

export async function insertPoItems(tx: Writer, items: (typeof procurementPoItems.$inferInsert)[]): Promise<void> {
  if (items.length) await tx.insert(procurementPoItems).values(items);
}
