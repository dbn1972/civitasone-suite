/**
 * Topic + event names owned by inventory-service. Convention: {service}.{entity}.{action}
 *
 * inventory-service models a realistic government store/inventory domain:
 *   item master (categories + units + reorder levels + valuation), stores,
 *   GRN receipts, issues/consumption, inter-store transfers, and
 *   stock-take adjustments with reason codes. Stock movements are valued in
 *   paise (minor units) using weighted-average costing.
 */
export const COMMANDS = {
  // Item master
  itemCreate:       "inventory.item.create",
  itemUpdate:       "inventory.item.update",
  categoryCreate:   "inventory.category.create",
  uomCreate:        "inventory.uom.create",
  // Stores (store locations)
  storeCreate:      "inventory.store.create",
  // Stock movements (CQRS write path)
  receiptCreate:    "inventory.receipt.create",
  issueCreate:      "inventory.issue.create",
  transferCreate:   "inventory.transfer.create",
  adjustmentCreate: "inventory.adjustment.create",
} as const;

export const EVENTS = {
  itemCreated:       "inventory.item.created",
  itemUpdated:       "inventory.item.updated",
  receiptPosted:     "inventory.receipt.posted",
  issuePosted:       "inventory.issue.posted",
  transferPosted:    "inventory.transfer.posted",
  adjustmentPosted:  "inventory.adjustment.posted",
  /** Emitted when an item's on-hand at a store falls to/below its reorder level. */
  stockLow:          "inventory.stock.low",
} as const;

/** Topics owned by OTHER services that inventory-service consumes. */
export const CONSUMED = {
  /** procurement-service signals a Goods Receipt Note has been accepted. */
  grnAccepted: "procurement.grn.accepted",
} as const;

/** Cross-cutting topics inventory-service publishes to. */
export const INTEGRATION = {
  audit: "audit.event.record",
  glPost: "finance.gl.post",
} as const;

export const SERVICE = "inventory";

/** Cache resource namespaces (under the `inventory` service key prefix). */
export const RESOURCE = {
  item:     "item",
  category: "category",
  uom:      "uom",
  store:    "store",
  balance:  "balance",
  ledger:   "ledger",
  lowStock: "low-stock",
} as const;
