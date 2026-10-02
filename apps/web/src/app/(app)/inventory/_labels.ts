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

/** Fallback label for a person id when no directory lookup can name them. */
export function userRefLabel(id: string | null | undefined): string {
  return id ? `User ${id.slice(0, 8)}` : "—";
}
