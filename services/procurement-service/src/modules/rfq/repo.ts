import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  procurementRfqs, procurementRfqItems, procurementRfqResponses,
  type RfqRow, type RfqInsert, type RfqResponseRow, type RfqResponseInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type RfqItemInsert = typeof procurementRfqItems.$inferInsert;

export async function insertRfq(tx: Writer, row: RfqInsert): Promise<void> {
  await tx.insert(procurementRfqs).values(row);
}

export async function insertRfqItems(tx: Writer, rows: RfqItemInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(procurementRfqItems).values(rows);
}

export async function findRfqById(id: string): Promise<RfqRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(procurementRfqs).where(eq(procurementRfqs.id, id)).limit(1));
  return rows[0] ?? null;
}

/**
 * DOM-011: tenant-scoped sibling of findRfqById(), for callers already inside
 * an open db.transaction() (rfq/consumer.ts's respond/close/award handlers).
 * The bare findRfqById() above opens its OWN nested db.transaction() from
 * inside the caller's already-open one -- the exact TX-001 nested-transaction
 * shape (see three-way-match/consumer.ts's comment / tests/tx-001-*) that can
 * exhaust the pool and deadlock under concurrent load. Route every
 * already-in-a-transaction caller through this instead.
 */
export async function findRfqByIdTx(tx: Writer, id: string, tenantId: string): Promise<RfqRow | null> {
  const rows = await (tx as typeof db).select().from(procurementRfqs)
    .where(and(eq(procurementRfqs.id, id), eq(procurementRfqs.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listRfqsByTenant(tenantId: string, limit: number, offset: number): Promise<RfqRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementRfqs)
    .where(eq(procurementRfqs.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
}

export async function findRfqItemsByRfq(rfqId: string): Promise<(typeof procurementRfqItems.$inferSelect)[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementRfqItems).where(eq(procurementRfqItems.rfqId, rfqId)));
}

/** DOM-011: tenant-scoped, already-in-a-transaction sibling of findRfqItemsByRfq() -- see findRfqByIdTx's doc for why. */
export async function findRfqItemsByRfqTx(tx: Writer, rfqId: string, tenantId: string): Promise<(typeof procurementRfqItems.$inferSelect)[]> {
  return (tx as typeof db).select().from(procurementRfqItems)
    .where(and(eq(procurementRfqItems.rfqId, rfqId), eq(procurementRfqItems.tenantId, tenantId)));
}

/** Optimistic-locked update, mirroring po/repo.ts's updatePoVersioned exactly: bumps version, throws if `expectedVersion` is stale. */
export async function updateRfqVersioned(tx: Writer, id: string, expectedVersion: number, patch: Partial<RfqInsert>): Promise<void> {
  const res = await (tx as typeof db).update(procurementRfqs)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(procurementRfqs.id, id), eq(procurementRfqs.version, expectedVersion)))
    .returning({ id: procurementRfqs.id });
  if (res.length === 0) {
    throw new Error(`OPTIMISTIC_LOCK_CONFLICT: rfq ${id} was modified concurrently (expected version ${expectedVersion})`);
  }
}

// ── DOM-011: vendor responses ────────────────────────────────────────────

/**
 * Upsert keyed on (rfq_id, vendor_id) -- a second response from the same
 * vendor to the same RFQ is treated as a revised quote, not an error (no
 * distinct "amend" endpoint exists; this is the pragmatic equivalent, and
 * matches how three-way-match/repo.ts's upsertDerivedMatch treats a
 * redelivered/updated compute the same way). The consumer only ever calls
 * this while the RFQ is still 'issued' (see rfq/consumer.ts), so an upsert
 * can never silently resurrect or mutate a response after award/close have
 * already decided its fate.
 */
export async function upsertResponse(tx: Writer, row: RfqResponseInsert): Promise<void> {
  await (tx as typeof db).execute(sql`
    INSERT INTO rfq.procurement_rfq_responses
      (id, tenant_id, rfq_id, vendor_id, items, total_amount_minor, valid_until, terms_accepted, remarks, status, created_by, updated_by)
    VALUES (
      ${row.id}::uuid, ${row.tenantId}::uuid, ${row.rfqId}::uuid, ${row.vendorId}::uuid,
      ${JSON.stringify(row.items ?? [])}::jsonb, ${(row.totalAmountMinor ?? 0n).toString()}::bigint,
      ${row.validUntil ?? null}, ${row.termsAccepted ?? false}, ${row.remarks ?? null},
      'submitted', ${row.createdBy}::uuid, ${row.updatedBy}::uuid
    )
    ON CONFLICT (rfq_id, vendor_id) DO UPDATE SET
      items              = EXCLUDED.items,
      total_amount_minor = EXCLUDED.total_amount_minor,
      valid_until        = EXCLUDED.valid_until,
      terms_accepted     = EXCLUDED.terms_accepted,
      remarks            = EXCLUDED.remarks,
      submitted_at       = now(),
      updated_by         = EXCLUDED.updated_by,
      version            = rfq.procurement_rfq_responses.version + 1
  `);
}

/** Already-in-a-transaction lookup used to decide insert-vs-revision before upserting (see rfq/consumer.ts: only a genuinely NEW response bumps responsesReceived). */
export async function findResponseByRfqAndVendorTx(tx: Writer, rfqId: string, vendorId: string, tenantId: string): Promise<RfqResponseRow | null> {
  const rows = await (tx as typeof db).select().from(procurementRfqResponses)
    .where(and(eq(procurementRfqResponses.rfqId, rfqId), eq(procurementRfqResponses.vendorId, vendorId), eq(procurementRfqResponses.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/** Already-in-a-transaction read (rfq/consumer.ts's award handler). */
export async function findResponsesByRfqTx(tx: Writer, rfqId: string, tenantId: string): Promise<RfqResponseRow[]> {
  return (tx as typeof db).select().from(procurementRfqResponses)
    .where(and(eq(procurementRfqResponses.rfqId, rfqId), eq(procurementRfqResponses.tenantId, tenantId)));
}

/** Already-in-a-transaction read (rfq/consumer.ts's award handler, to validate the chosen responseId). */
export async function findResponseByIdTx(tx: Writer, id: string, tenantId: string): Promise<RfqResponseRow | null> {
  const rows = await (tx as typeof db).select().from(procurementRfqResponses)
    .where(and(eq(procurementRfqResponses.id, id), eq(procurementRfqResponses.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/** Standalone read for the HTTP query path (rfq/queries.ts's getRfqDetail) -- mirrors findRfqItemsByRfq's bare-db.transaction() shape. */
export async function findResponsesByRfq(rfqId: string, tenantId: string): Promise<RfqResponseRow[]> {
  return db.transaction((tx) => tx.select().from(procurementRfqResponses)
    .where(and(eq(procurementRfqResponses.rfqId, rfqId), eq(procurementRfqResponses.tenantId, tenantId))));
}

/** Optimistic-locked update for a single response row (award/reject transitions). */
export async function updateResponseVersioned(tx: Writer, id: string, expectedVersion: number, patch: Partial<RfqResponseInsert>): Promise<void> {
  const res = await (tx as typeof db).update(procurementRfqResponses)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(procurementRfqResponses.id, id), eq(procurementRfqResponses.version, expectedVersion)))
    .returning({ id: procurementRfqResponses.id });
  if (res.length === 0) {
    throw new Error(`OPTIMISTIC_LOCK_CONFLICT: rfq response ${id} was modified concurrently (expected version ${expectedVersion})`);
  }
}
