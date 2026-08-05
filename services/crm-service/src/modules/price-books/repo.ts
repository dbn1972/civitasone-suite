/**
 * Price-book reads + resolution (QP-002). Raw SQL under tenant RLS. price_minor is bigint
 * MINOR units, surfaced as a STRING.
 */
import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";

export interface PriceBookView {
  id: string;
  name: string;
  segment: string | null;
  currency: string;
  geography: string | null;
  channel: string | null;
  priority: number;
  enabled: boolean;
  version: number;
}

const COLS = sql`id, name, segment, currency, geography, channel, priority, enabled, version`;

export async function findById(tenantId: string, id: string): Promise<PriceBookView | null> {
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT ${COLS} FROM crm.price_books WHERE id = ${id} AND tenant_id = ${tenantId}
  `)) as unknown as PriceBookView[];
  return rows[0] ?? null;
}

export async function list(tenantId: string, limit: number, offset: number): Promise<{ rows: PriceBookView[]; total: number }> {
  return scopedRead(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT ${COLS} FROM crm.price_books WHERE tenant_id = ${tenantId}
      ORDER BY priority DESC, name ASC LIMIT ${limit} OFFSET ${offset}
    `) as unknown as PriceBookView[];
    const counted = await tx.execute(sql`
      SELECT count(*)::int AS total FROM crm.price_books WHERE tenant_id = ${tenantId}
    `) as unknown as Array<{ total: number }>;
    return { rows, total: counted[0]?.total ?? 0 };
  });
}

export interface ResolveCriteria {
  segment?: string | undefined;
  currency?: string | undefined;
  geography?: string | undefined;
  channel?: string | undefined;
}

/**
 * QP-002: resolve the single applicable price book for the given criteria — the highest
 * priority ENABLED book whose segment/geography/channel either match the request or are
 * NULL (wildcard). Currency, when supplied, must match exactly. Null when nothing matches.
 */
export async function resolve(tenantId: string, c: ResolveCriteria): Promise<PriceBookView | null> {
  const segF = c.segment !== undefined ? sql`AND (segment = ${c.segment} OR segment IS NULL)` : sql``;
  const geoF = c.geography !== undefined ? sql`AND (geography = ${c.geography} OR geography IS NULL)` : sql``;
  const chF = c.channel !== undefined ? sql`AND (channel = ${c.channel} OR channel IS NULL)` : sql``;
  const curF = c.currency !== undefined ? sql`AND currency = ${c.currency}` : sql``;
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT ${COLS} FROM crm.price_books
    WHERE tenant_id = ${tenantId} AND enabled = true ${segF} ${geoF} ${chF} ${curF}
    ORDER BY priority DESC, name ASC
    LIMIT 1
  `)) as unknown as PriceBookView[];
  return rows[0] ?? null;
}

export interface PriceBookItemView {
  id: string;
  priceBookId: string;
  productId: string;
  priceMinor: string;
}

export async function listItems(tenantId: string, priceBookId: string): Promise<PriceBookItemView[]> {
  return scopedRead(async (tx) => tx.execute(sql`
    SELECT id, price_book_id AS "priceBookId", product_id AS "productId", price_minor::text AS "priceMinor"
    FROM crm.price_book_items WHERE tenant_id = ${tenantId} AND price_book_id = ${priceBookId}
    ORDER BY created_at ASC
  `)) as unknown as PriceBookItemView[];
}
