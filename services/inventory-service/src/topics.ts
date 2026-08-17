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
  // Substitutes (SVC-051)
  substituteCreate: "inventory.substitute.create",
  // Bins/rack (SVC-052)
  binCreate:        "inventory.bin.create",
  // Reservations/allocations (SVC-054)
  reservationCreate:  "inventory.reservation.create",
  reservationRelease: "inventory.reservation.release",
  // Goods returns + QC (SVC-053)
  goodsReturnCreate:  "inventory.goods_return.create",
  goodsReturnInspect: "inventory.goods_return.inspect",
  // Stores (store locations)
  storeCreate:      "inventory.store.create",
  // Warehouses (canonical model — unification with stock-service)
  warehouseCreate:  "inventory.warehouse.create",
  warehouseUpdate:  "inventory.warehouse.update",
  // Stock movements (CQRS write path)
  receiptCreate:    "inventory.receipt.create",
  issueCreate:      "inventory.issue.create",
  transferCreate:   "inventory.transfer.create",
  adjustmentCreate: "inventory.adjustment.create",
  // Batch and serial tracking
  batchCreate:      "inventory.batch.create",
  batchIssue:       "inventory.batch.issue",
  serialRegister:   "inventory.serial.register",
  // Batch quarantine/recall (SVC-055)
  batchQuarantine:  "inventory.batch.quarantine",
  batchRecall:      "inventory.batch.recall",
  // Cycle count
  cycleCountCreate:  "inventory.cycle-count.create",
  cycleCountApprove: "inventory.cycle-count.approve",
  cycleCountReject:  "inventory.cycle-count.reject",
  // Three-way match
  threeWayMatchCreate:  "inventory.match.create",
  threeWayMatchResolve: "inventory.match.resolve",
  // Store Receipt Note (SRN) — GFR Rule 149 (Req 1.1)
  srnCreate: "inventory.srn.create",
  srnSign:   "inventory.srn.sign",
} as const;

export const EVENTS = {
  itemCreated:       "inventory.item.created",
  itemUpdated:       "inventory.item.updated",
  receiptPosted:     "inventory.receipt.posted",
  issuePosted:       "inventory.issue.posted",
  transferPosted:    "inventory.transfer.posted",
  adjustmentPosted:  "inventory.adjustment.posted",
  /** Emitted when a warehouse is created (canonical model). */
  warehouseCreated:  "inventory.warehouse.created",
  /** Emitted when a warehouse is updated (canonical model). */
  warehouseUpdated:  "inventory.warehouse.updated",
  /** Emitted when an item's on-hand at a store falls to/below its reorder level. */
  stockLow:          "inventory.stock.low",
  /** Emitted when a batch is created. */
  batchCreated:      "inventory.batch.created",
  /** Emitted when stock is issued from a batch. */
  batchIssued:       "inventory.batch.issued",
  /** Emitted when a serial number is registered. */
  serialRegistered:  "inventory.serial.registered",
  /** Emitted when a cycle count is auto-posted (within threshold). */
  cycleCountAutoPosted: "inventory.cycle-count.auto-posted",
  /** Emitted when a cycle count is approved and posted. */
  cycleCountApproved: "inventory.cycle-count.approved",
  /** Emitted when a cycle count is rejected. */
  cycleCountRejected: "inventory.cycle-count.rejected",
  /** Emitted when a three-way match is completed. */
  matchCompleted:    "inventory.match.completed",
  /** Emitted when a three-way match discrepancy is resolved. */
  matchResolved:     "inventory.match.resolved",
  /** Emitted when a substitute is registered for an item. */
  substituteCreated: "inventory.substitute.created",
  /** Emitted when a bin location is created in a store. */
  binCreated:        "inventory.bin.created",
  /** Emitted when stock is reserved against an indent/PO. */
  reservationCreated: "inventory.reservation.created",
  /** Emitted when a reservation is released (issued or cancelled). */
  reservationReleased: "inventory.reservation.released",
  /** Emitted when goods are returned and a QC inspection is pending. */
  goodsReturnCreated: "inventory.goods_return.created",
  /** Emitted when QC inspection is completed on returned goods. */
  goodsReturnInspected: "inventory.goods_return.inspected",
  /** Emitted when a batch is quarantined (quality/expiry concern). */
  batchQuarantined: "inventory.batch.quarantined",
  /** Emitted when a batch recall is issued — traces to all issued locations. */
  batchRecalled:     "inventory.batch.recalled",
  /** Emitted when a Store Receipt Note is created (status 'draft'). */
  srnCreated:        "inventory.srn.created",
  /** Emitted when a Store Receipt Note is signed by the store officer. */
  srnSigned:         "inventory.srn.signed",
  /** Emitted by the three-way-match consumer when SRN + match are both clear — gates payment. */
  paymentReleased:   "inventory.payment.released",
  /** Emitted by the three-way-match consumer when SRN is missing/unsigned or match failed. */
  paymentBlocked:    "inventory.payment.blocked",
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
  item:          "item",
  category:      "category",
  uom:           "uom",
  store:         "store",
  warehouse:     "warehouse",
  balance:       "balance",
  ledger:        "ledger",
  lowStock:      "low-stock",
  batch:         "batch",
  serial:        "serial",
  cycleCount:    "cycle-count",
  threeWayMatch: "three-way-match",
  srn:           "srn",
  goodsReturn:   "goods-return",
} as const;
