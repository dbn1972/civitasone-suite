import {
  pgSchema, uuid, text, integer, bigint, char, varchar, date, timestamp,
} from "drizzle-orm/pg-core";

export const entrySchema = pgSchema("entry");

export const stockEntries = entrySchema.table("stock_entries", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  entryType:        varchar("entry_type", { length: 16 }).notNull(),
  refDoc:           text("ref_doc"),
  refNo:            text("ref_no"),
  postingDate:      date("posting_date").notNull(),
  fromWarehouseId:  uuid("from_warehouse_id"),
  toWarehouseId:    uuid("to_warehouse_id"),
  notes:            text("notes"),
  status:           varchar("status", { length: 16 }).notNull().default("draft"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const stockEntryItems = entrySchema.table("stock_entry_items", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  entryId:     uuid("entry_id").notNull(),
  itemId:      uuid("item_id").notNull(),
  qty:         integer("qty").notNull(),
  rateMinor:   bigint("rate_minor", { mode: "bigint" }).notNull().default(0n),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type EntryRow       = typeof stockEntries.$inferSelect;
export type EntryInsert    = typeof stockEntries.$inferInsert;
export type EntryItemRow   = typeof stockEntryItems.$inferSelect;
export type EntryItemInsert= typeof stockEntryItems.$inferInsert;

export const schema = { stockEntries, stockEntryItems };
