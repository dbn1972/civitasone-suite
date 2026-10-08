/**
 * GAP2-PROCUREMENT-GRN-DETAIL-06 — GRN rows store a cross-domain PO reference
 * as the opaque composite `procurement_po:<uuid>` (house rule 13: opaque IDs
 * for linking, not for display). Rendering it raw shows a clerk
 * `procurement_po:cccccccc-0001-…`, which is unusable and not clickable.
 *
 * parsePoRef splits that composite into the bare PO uuid so the page can resolve
 * it to a human PO number and link to `/procurement/orders/<uuid>`. It returns
 * null for a missing/placeholder ref (so callers fall back to "—") and tolerates
 * a value that is already a bare uuid (no prefix).
 *
 *   parsePoRef("procurement_po:abc-123")   -> "abc-123"
 *   parsePoRef("abc-123")                  -> "abc-123"
 *   parsePoRef("procurement_po:undefined") -> null
 *   parsePoRef(null)                       -> null
 */
export function parsePoRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  if (!trimmed || trimmed === "undefined" || trimmed.endsWith(":undefined")) return null;
  const PREFIX = "procurement_po:";
  const id = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed;
  return id.length > 0 ? id : null;
}
