import { and, eq, or, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { threeWayMatch, threeWayMatchConfig, type ThreeWayMatchRow, type ThreeWayMatchConfigRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** DOM-011: sentinel tenant_id for the platform-default tolerance config row (see migration 0033). */
export const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export interface DerivedMatch {
  id: string;
  tenantId: string;
  poId: string;
  grnId: string;
  poAmountMinor: bigint;
  grnAmountMinor: bigint;
  matchStatus: string;
  invoiceId?: string | null;
  invoiceAmountMinor?: bigint;
  /** Computed variance percentage for this match (persisted alongside match_status). */
  variancePct?: number | null;
  /** True for every row this system-derived upsert writes (no manual-entry path exists yet). */
  autoMatched?: boolean;
  /** DOM-011: the other two computed variance axes, and the three thresholds that were actually applied at match time (see schema.ts/migration 0033). */
  qtyVariancePct?: number | null;
  priceVariancePct?: number | null;
  qtyTolerancePct?: number | null;
  priceTolerancePct?: number | null;
  totalTolerancePct?: number | null;
}

/**
 * Upsert a three-way-match row keyed on (tenant, po, grn). Amounts MUST be
 * derived server-side by the caller. Idempotent for the GRN consumer; the
 * invoice-match endpoint can later upgrade the same row with an invoice.
 */
export async function upsertDerivedMatch(tx: Writer, m: DerivedMatch): Promise<void> {
  await (tx as typeof db).execute(sql`
    INSERT INTO procurement.three_way_match
      (id, tenant_id, po_id, grn_id, invoice_id, po_amount_minor, grn_amount_minor, invoice_amount_minor, match_status, variance_pct, auto_matched,
       qty_variance_pct, price_variance_pct, qty_tolerance_pct, price_tolerance_pct, tolerance_pct)
    VALUES (
      ${m.id}::uuid, ${m.tenantId}::uuid, ${m.poId}::uuid, ${m.grnId}::uuid,
      ${m.invoiceId ?? null}, ${m.poAmountMinor.toString()}::bigint, ${m.grnAmountMinor.toString()}::bigint,
      ${(m.invoiceAmountMinor ?? 0n).toString()}::bigint, ${m.matchStatus}, ${m.variancePct ?? null}, ${m.autoMatched ?? true},
      ${m.qtyVariancePct ?? null}, ${m.priceVariancePct ?? null},
      ${m.qtyTolerancePct ?? null}, ${m.priceTolerancePct ?? null},
      ${m.totalTolerancePct ?? "5.00"}
    )
    ON CONFLICT (tenant_id, po_id, grn_id) DO UPDATE SET
      po_amount_minor      = EXCLUDED.po_amount_minor,
      grn_amount_minor     = EXCLUDED.grn_amount_minor,
      invoice_id           = COALESCE(EXCLUDED.invoice_id, procurement.three_way_match.invoice_id),
      invoice_amount_minor = CASE WHEN EXCLUDED.invoice_id IS NOT NULL
                                  THEN EXCLUDED.invoice_amount_minor
                                  ELSE procurement.three_way_match.invoice_amount_minor END,
      match_status         = EXCLUDED.match_status,
      variance_pct         = EXCLUDED.variance_pct,
      auto_matched         = EXCLUDED.auto_matched,
      qty_variance_pct     = EXCLUDED.qty_variance_pct,
      price_variance_pct   = EXCLUDED.price_variance_pct,
      qty_tolerance_pct    = EXCLUDED.qty_tolerance_pct,
      price_tolerance_pct  = EXCLUDED.price_tolerance_pct,
      tolerance_pct        = EXCLUDED.tolerance_pct
  `);
}

/**
 * DOM-011: standalone (non-transactional-caller) read of the tenant's own
 * tolerance-config row plus the platform-default row, for callers outside an
 * already-open transaction (diagnostics, tests). Mirrors payroll's
 * statutory/repo.ts functions that use scopedRead for exactly this reason.
 * The hot path (the three-way-match consumer, already inside its own open
 * transaction) uses resolveThreeWayMatchToleranceConfig() in consumer.ts
 * instead, sharing that transaction's connection -- see the TX-001 comment
 * there on why opening a second, independent transaction from inside an
 * already-open one is a pool-exhaustion/deadlock risk under load.
 */
export async function getToleranceConfigRows(tenantId: string): Promise<ThreeWayMatchConfigRow[]> {
  return scopedRead((tx) => tx.select().from(threeWayMatchConfig)
    .where(or(eq(threeWayMatchConfig.tenantId, tenantId), eq(threeWayMatchConfig.tenantId, PLATFORM_TENANT_ID))));
}

export async function listByTenant(tenantId: string, poId: string | undefined, limit: number, offset: number): Promise<ThreeWayMatchRow[]> {
  const where = poId
    ? and(eq(threeWayMatch.tenantId, tenantId), eq(threeWayMatch.poId, poId))
    : eq(threeWayMatch.tenantId, tenantId);
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(threeWayMatch).where(where).limit(limit).offset(offset));
}

export async function findLatestForPoGrn(tenantId: string, poId: string, grnId: string): Promise<ThreeWayMatchRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(threeWayMatch)
    .where(and(eq(threeWayMatch.tenantId, tenantId), eq(threeWayMatch.poId, poId), eq(threeWayMatch.grnId, grnId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function findMatchById(id: string, tenantId: string): Promise<ThreeWayMatchRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(threeWayMatch)
    .where(and(eq(threeWayMatch.id, id), eq(threeWayMatch.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}
