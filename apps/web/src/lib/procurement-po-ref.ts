/**
 * A contract's linked-PO reference (`poRef`) is stored as one of: the opaque
 * composite `procurement_po:<uuid>`, a bare uuid, or free text typed on the
 * create form (contract-service does not validate it against procurement).
 *
 * Only a uuid names a purchase order we can open, so only a uuid becomes a link;
 * anything else is shown as typed and never turned into a route.
 */
const PO_REF_UUID = /^(?:procurement_po:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The PO id inside `poRef`, or null when it is empty or not a PO uuid. */
export function poIdFromRef(poRef: string | null | undefined): string | null {
  if (!poRef) return null;
  const m = PO_REF_UUID.exec(poRef.trim());
  return m ? m[1]!.toLowerCase() : null;
}

/** The PO detail route for `poRef`, or null when it cannot be linked. */
export function poHrefFromRef(poRef: string | null | undefined): string | null {
  const id = poIdFromRef(poRef);
  return id ? `/procurement/orders/${id}` : null;
}
