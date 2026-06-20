export const COMMANDS = {
  itemCreate:           "stock.item.create",
  warehouseCreate:      "stock.warehouse.create",
  entryCreate:          "stock.entry.create",
  physicalCreate:       "stock.physical.create",
} as const;

export const EVENTS = {
  entryCreated:  "stock.entry.created",
  stockNegative: "stock.stock.negative_rejected",
} as const;

export const CONSUMED = {
  grnAccepted: "procurement.grn.accepted",
} as const;

export const SERVICE = "stock";
