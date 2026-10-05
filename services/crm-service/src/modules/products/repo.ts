/**
 * Products catalogue reads + the active-selectability check (QP-001).
 * Raw SQL under tenant RLS (scopedRead). price_minor is bigint MINOR units, surfaced as
 * a STRING so values above 2^53 survive JSON. No float touches a money value.
 */
import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";

export interface ProductView {
  id: string;
  category: string | null;
  code: string;
  name: string;
  unit: string;
  taxRateBps: number;
  hsnSac: string | null;
  priceMinor: string;
  currency: string;
  activeFrom: string | null;
  activeTo: string | null;
  enabled: boolean;
  version: number;
}

const COLS = sql`
  id, category, code, name, unit,
  tax_rate_bps AS "taxRateBps",
  hsn_sac AS "hsnSac",
  price_minor::text AS "priceMinor",
  currency,
  active_from AS "activeFrom",
  active_to AS "activeTo",
  enabled, version
`;

export async function findById(tenantId: string, id: string): Promise<ProductView | null> {
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT ${COLS} FROM crm.products WHERE id = ${id} AND tenant_id = ${tenantId}
  `)) as unknown as ProductView[];
  return rows[0] ?? null;
}

export async function findByCode(tenantId: string, code: string): Promise<ProductView | null> {
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT ${COLS} FROM crm.products WHERE code = ${code} AND tenant_id = ${tenantId}
  `)) as unknown as ProductView[];
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { limit: number; offset: number; activeOnly: boolean; category?: string },
): Promise<{ rows: ProductView[]; total: number }> {
  const activeFilter = opts.activeOnly
    ? sql`AND enabled = true
          AND (active_from IS NULL OR active_from <= CURRENT_DATE)
          AND (active_to IS NULL OR active_to >= CURRENT_DATE)`
    : sql``;
  const catFilter = opts.category ? sql`AND category = ${opts.category}` : sql``;
  return scopedRead(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT ${COLS} FROM crm.products
      WHERE tenant_id = ${tenantId} ${activeFilter} ${catFilter}
      ORDER BY code ASC LIMIT ${opts.limit} OFFSET ${opts.offset}
    `) as unknown as ProductView[];
    const counted = await tx.execute(sql`
      SELECT count(*)::int AS total FROM crm.products
      WHERE tenant_id = ${tenantId} ${activeFilter} ${catFilter}
    `) as unknown as Array<{ total: number }>;
    return { rows, total: counted[0]?.total ?? 0 };
  });
}

/**
 * QP-001/QP-003: is this product selectable on a quotation line today? True only when it
 * exists, is enabled, and CURRENT_DATE falls inside its [active_from, active_to] window.
 */
export async function isSelectable(tenantId: string, id: string): Promise<boolean> {
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT 1 AS ok FROM crm.products
    WHERE id = ${id} AND tenant_id = ${tenantId} AND enabled = true
      AND (active_from IS NULL OR active_from <= CURRENT_DATE)
      AND (active_to IS NULL OR active_to >= CURRENT_DATE)
  `)) as unknown as Array<{ ok: number }>;
  return rows.length > 0;
}

/**
 * F4-03: the currency each of the given products carries, keyed by product id. Used to
 * enforce that a quotation stays single-currency — a line sourced from a product in a
 * different currency to the quotation header is rejected (422) at the route boundary.
 */
export async function currenciesByIds(
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id) => id)));
  if (unique.length === 0) return new Map();
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT id, currency FROM crm.products
    WHERE tenant_id = ${tenantId}
      AND id = ANY(${sql`ARRAY[${sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `)}]`})
  `)) as unknown as Array<{ id: string; currency: string }>;
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.id, (r.currency ?? "").toUpperCase());
  return map;
}
