/**
 * Client-safe display helpers for the inventory registers. Rows reach the
 * browser already enriched with names (see _lookups.ts); these turn them into
 * text and own the fallbacks, so a row whose item/store was deleted or fell
 * outside the lookup window still renders (as a short id) instead of crashing.
 */
export type ItemRef = { itemId: string; itemName?: string | null; itemSku?: string | null };

/** "SKU - name", else the name, else the first 8 chars of the id. */
export function itemLabel(r: ItemRef): string {
  const name = r.itemName?.trim();
  if (!name) return r.itemId.slice(0, 8);
  const sku = r.itemSku?.trim();
  return sku ? `${sku} · ${name}` : name;
}

/** A resolved name, or "—" when the lookup could not name it (id stays in the tooltip). */
export function nameOrDash(name: string | null | undefined): string {
  const n = name?.trim();
  return n ? n : "—";
}

/**
 * A person by name when identity-service could name them (the inventory-service detail
 * endpoints resolve it), else the neutral "User <id prefix>" fallback, else "—".
 */
export function userRefLabel(id: string | null | undefined, name?: string | null): string {
  const n = name?.trim();
  if (n) return n;
  return id ? `User ${id.slice(0, 8)}` : "—";
}

const GENERIC_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Receipt document reference for the register (GAP-INVENTORY-RECEIPTS-03):
 * "GRN GRN-2026-0012" / "PO PO-77". Returns null when there is nothing human to
 * show -- a legacy GRN row only carries the GRN uuid as refNo, which is not a
 * document number, so a bare uuid is never shown.
 */
export function receiptDocLabels(r: { refDoc?: string | null; refNo?: string | null; grnNo?: string | null; poRef?: string | null }): {
  grn: string | null;
  po: string | null;
} {
  const grn = r.grnNo?.trim() || (r.refNo && !GENERIC_UUID.test(r.refNo.trim()) ? r.refNo.trim() : null);
  const po = r.poRef?.trim() || null;
  return { grn, po };
}

export type LowStockSeverity = { label: string; variant: "bad" | "warn" };

/**
 * Severity of a low-stock row from its on-hand quantity against its reorder
 * level (GAP-INVENTORY-LOW-STOCK-03): nothing left, at or below half the
 * level, or merely at/below the level.
 */
export function lowStockSeverity(onHandQty: number, reorderLevel: number): LowStockSeverity {
  if (onHandQty <= 0) return { label: "Out of stock", variant: "bad" };
  if (reorderLevel > 0 && onHandQty <= reorderLevel / 2) return { label: "Critical", variant: "bad" };
  return { label: "Low", variant: "warn" };
}

/**
 * Prefilled "Raise indent" target. The indent form takes the SKU as the item
 * code, the item name as the description and the suggested quantity; a
 * non-positive or non-integer suggestion is dropped rather than prefilled.
 */
export function raiseIndentHref(r: { sku: string | null; name: string; suggestedReorderQty: number }): string {
  const qs = new URLSearchParams();
  if (r.sku?.trim()) qs.set("itemCode", r.sku.trim());
  qs.set("description", r.name);
  if (Number.isInteger(r.suggestedReorderQty) && r.suggestedReorderQty > 0) qs.set("quantity", String(r.suggestedReorderQty));
  return `/procurement/indents/new?${qs.toString()}`;
}

/** A reservation that is currently holding stock. One predicate for the stats and the table. */
export function isActiveReservation(r: { status: string }): boolean {
  return r.status === "active";
}

/**
 * Conversion factor as "1 : 1.5". The service sends a fixed-scale decimal
 * string ("1.500000"); a non-numeric value is shown raw rather than as NaN.
 */
export function formatConversionFactor(raw: string): string {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) return raw;
  return `1 : ${Number(n.toFixed(6))}`;
}
