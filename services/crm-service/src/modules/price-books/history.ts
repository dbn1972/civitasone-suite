/**
 * Price-book change history (GAP-CRM-PRICE-BOOKS-01).
 *
 * A price book is edited in place, and crm.price_books keeps only the LAST version /
 * updated_by / updated_at. Every version bump therefore also appends one row to the
 * append-only crm.price_book_history (migration 0171) IN THE SAME TRANSACTION as the
 * change, carrying who/when/why and a compact before-after summary, so the editor can show
 * what actually moved. The diff helpers are pure so they are unit-testable without a DB.
 *
 * Money is bigint MINOR units carried as decimal strings -- never a JS number.
 */
import { sql } from "drizzle-orm";

export type HistoryAction = "create" | "update" | "item";

export interface FieldChange {
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

export interface PriceChange {
  productId: string;
  /** Price in force before the change (minor units), null when the product was added. */
  fromMinor: string | null;
  /** Price after the change (minor units), null when the product was removed. */
  toMinor: string | null;
}

export interface PriceBookChanges {
  fields?: FieldChange[];
  prices?: PriceChange[];
  /** Total number of price changes (the list is capped at MAX_PRICE_CHANGES). */
  priceChangeCount?: number;
  /** Number of price entries the book holds after the change. */
  entryCount?: number;
}

/** Book columns an update may change, in display order. */
export const TRACKED_FIELDS = ["name", "segment", "currency", "geography", "channel", "priority", "enabled"] as const;

/** Cap on the per-product list stored in `changes` (the count is always exact). */
export const MAX_PRICE_CHANGES = 200;

export interface PriceEntry {
  productId: string;
  priceMinor: string;
}

type Scalar = string | number | boolean | null;
const norm = (v: unknown): Scalar => (v === undefined || v === null ? null : (v as Scalar));

/** Fields the patch actually changes (unchanged / not-supplied fields are omitted). */
export function diffFields(before: Record<string, unknown>, patch: Record<string, unknown>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of TRACKED_FIELDS) {
    if (patch[field] === undefined) continue;
    const from = norm(before[field]);
    const to = norm(patch[field]);
    if (from !== to) out.push({ field, from, to });
  }
  return out;
}

/** Per-product price movements between two entry sets (added / changed / removed). */
export function diffPrices(before: readonly PriceEntry[], after: readonly PriceEntry[]): PriceChange[] {
  const was = new Map(before.map((e) => [e.productId, BigInt(e.priceMinor || "0")]));
  const now = new Map(after.map((e) => [e.productId, BigInt(e.priceMinor || "0")]));
  const out: PriceChange[] = [];
  for (const [productId, to] of now) {
    const from = was.get(productId);
    if (from === undefined) out.push({ productId, fromMinor: null, toMinor: to.toString() });
    else if (from !== to) out.push({ productId, fromMinor: from.toString(), toMinor: to.toString() });
  }
  for (const [productId, from] of was) {
    if (!now.has(productId)) out.push({ productId, fromMinor: from.toString(), toMinor: null });
  }
  return out;
}

/** Fold a price diff into the stored summary, capping the list but keeping the exact count. */
export function priceSummary(changes: PriceChange[]): Pick<PriceBookChanges, "prices" | "priceChangeCount"> {
  return { prices: changes.slice(0, MAX_PRICE_CHANGES), priceChangeCount: changes.length };
}

type Tx = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

export interface HistoryEntry {
  tenantId: string;
  priceBookId: string;
  version: number;
  action: HistoryAction;
  actorId: string;
  reason?: string | null | undefined;
  changes: PriceBookChanges;
}

/** Append one history row. Call inside the same transaction as the change it records. */
export async function recordHistory(tx: Tx, h: HistoryEntry): Promise<void> {
  await tx.execute(sql`
    INSERT INTO crm.price_book_history (tenant_id, price_book_id, version, action, changed_by, reason, changes)
    VALUES (${h.tenantId}, ${h.priceBookId}, ${h.version}, ${h.action}, ${h.actorId},
            ${h.reason && h.reason.trim() ? h.reason.trim() : null}, ${JSON.stringify(h.changes)}::jsonb)
  `);
}

/** Bump the book's version / updated_by / updated_at and return the new version (null if absent). */
export async function bumpVersion(tx: Tx, tenantId: string, priceBookId: string, actorId: string): Promise<number | null> {
  const rows = (await tx.execute(sql`
    UPDATE crm.price_books SET updated_at = now(), updated_by = ${actorId}, version = version + 1
    WHERE id = ${priceBookId} AND tenant_id = ${tenantId}
    RETURNING version
  `)) as unknown as Array<{ version: number }>;
  return rows[0]?.version ?? null;
}
