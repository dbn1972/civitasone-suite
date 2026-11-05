/**
 * UAT L2-N6: the finance.gl.post payload of a stock movement (consumed by
 * finance-service gl/inventory-movement.ts; tests/contract/inventory-gl-post
 * feeds this exact shape to finance). Money as a paise decimal string. Pure.
 */
export interface InventoryGlPostInput {
  movementId: string;
  kind: "receipt" | "issue";
  totalMinor: bigint;
  postingDate: string;
  storeId?: string | null | undefined;
  refDoc?: string | null | undefined;
  refNo?: string | null | undefined;
}

export function inventoryGlPostPayload(i: InventoryGlPostInput): Record<string, string> {
  return {
    type: "inventory_movement",
    movementId: i.movementId,
    kind: i.kind,
    totalMinor: i.totalMinor.toString(),
    postingDate: i.postingDate,
    ...(i.storeId ? { storeId: i.storeId } : {}),
    ...(i.refDoc ? { refDoc: i.refDoc } : {}),
    ...(i.refNo ? { refNo: i.refNo } : {}),
  };
}
