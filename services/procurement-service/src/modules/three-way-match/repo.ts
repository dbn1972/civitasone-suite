import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { threeWayMatch, type ThreeWayMatchRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export interface DerivedMatch {
  tenantId: string;
  poId: string;
  grnId: string;
  poAmountMinor: bigint;
  grnAmountMinor: bigint;
  matchStatus: string;
  invoiceId?: string | null;
  invoiceAmountMinor?: bigint;
}

/**
 * Upsert a three-way-match row keyed on (tenant, po, grn). Amounts MUST be
 * derived server-side by the caller. Idempotent for the GRN consumer; the
 * invoice-match endpoint can later upgrade the same row with an invoice.
 */
export async function upsertDerivedMatch(tx: Writer, m: DerivedMatch): Promise<void> {
  await (tx as typeof db).execute(sql`
    INSERT INTO procurement.three_way_match
      (tenant_id, po_id, grn_id, invoice_id, po_amount_minor, grn_amount_minor, invoice_amount_minor, match_status)
    VALUES (
      ${m.tenantId}::uuid, ${m.poId}::uuid, ${m.grnId}::uuid,
      ${m.invoiceId ?? null}, ${m.poAmountMinor.toString()}::bigint, ${m.grnAmountMinor.toString()}::bigint,
      ${(m.invoiceAmountMinor ?? 0n).toString()}::bigint, ${m.matchStatus}
    )
    ON CONFLICT (tenant_id, po_id, grn_id) DO UPDATE SET
      po_amount_minor      = EXCLUDED.po_amount_minor,
      grn_amount_minor     = EXCLUDED.grn_amount_minor,
      invoice_id           = COALESCE(EXCLUDED.invoice_id, procurement.three_way_match.invoice_id),
      invoice_amount_minor = CASE WHEN EXCLUDED.invoice_id IS NOT NULL
                                  THEN EXCLUDED.invoice_amount_minor
                                  ELSE procurement.three_way_match.invoice_amount_minor END,
      match_status         = EXCLUDED.match_status
  `);
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
