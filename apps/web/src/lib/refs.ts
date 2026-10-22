/**
 * Opaque cross-service references are stored as "<type>:<id>" (see CLAUDE.md
 * rule 13: "Reference other domains by opaque ID (\"procurement_po:UUID\")").
 * The UI must never print the raw ref — it shows a human number and links to
 * the referenced record. `parseOpaqueRef` splits that shape safely.
 *
 * Mirrors the producer side in CreateRFQForm (`procurement_indent:${indentId}`)
 * and the display-guard convention in lib/formatters.ts's formatInternalRef:
 * a ref whose id is literally missing ("...:undefined", "...:", or no colon)
 * is treated as absent (returns null) rather than rendered as a broken id.
 *
 *   parseOpaqueRef("procurement_indent:abc-123") -> { type: "procurement_indent", id: "abc-123" }
 *   parseOpaqueRef("procurement_indent:undefined") -> null
 *   parseOpaqueRef("procurement_indent:")          -> null
 *   parseOpaqueRef("abc-123")                        -> null   (no type prefix)
 *   parseOpaqueRef(null)                             -> null
 */
export type OpaqueRef = { type: string; id: string };

export function parseOpaqueRef(ref: string | null | undefined): OpaqueRef | null {
  if (!ref) return null;
  const idx = ref.indexOf(":");
  if (idx <= 0) return null; // no prefix, or leading ":"
  const type = ref.slice(0, idx);
  const id = ref.slice(idx + 1);
  if (!id || id === "undefined") return null;
  return { type, id };
}

/**
 * The in-app detail route for a known opaque ref type, or null when the type
 * is one the UI has no route for (so the caller renders plain text, never a
 * dead link). `procurement_indent` and `procurement_po` are wired today — add
 * more as routes exist.
 *
 * A purchase order is addressed by its UUID (`/procurement/orders/[id]`), so a
 * `procurement_po` ref whose id is not a UUID (a hand-typed reference) has no
 * page to open and gets no link.
 */
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function opaqueRefHref(ref: string | null | undefined): string | null {
  const parsed = parseOpaqueRef(ref);
  if (!parsed) return null;
  if (parsed.type === "procurement_indent") return `/procurement/indents/${parsed.id}`;
  if (parsed.type === "procurement_po" && UUID_ID.test(parsed.id)) return `/procurement/orders/${parsed.id}`;
  return null;
}
