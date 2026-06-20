import {
  pgSchema, uuid, text, integer, bigint, char, varchar, date, timestamp,
} from "drizzle-orm/pg-core";

export const lifecycleSchema = pgSchema("lifecycle");

export const assetAcquisitions = lifecycleSchema.table("asset_acquisitions", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  assetId:         uuid("asset_id").notNull(),
  acquisitionDate: date("acquisition_date").notNull(),
  costMinor:       bigint("cost_minor", { mode: "bigint" }).notNull(),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  vendorId:        text("vendor_id"),
  poRef:           text("po_ref"),
  grnRef:          text("grn_ref"),
  notes:           text("notes"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const assetTransfers = lifecycleSchema.table("asset_transfers", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  assetId:      uuid("asset_id").notNull(),
  fromLocation: text("from_location").notNull(),
  toLocation:   text("to_location").notNull(),
  transferDate: date("transfer_date").notNull(),
  notes:        text("notes"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const assetDisposals = lifecycleSchema.table("asset_disposals", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assetId:        uuid("asset_id").notNull(),
  disposalDate:   date("disposal_date").notNull(),
  disposalMethod: varchar("disposal_method", { length: 32 }).notNull().default("sale"),
  proceedsMinor:  bigint("proceeds_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  gainLossMinor:  bigint("gain_loss_minor", { mode: "bigint" }).notNull().default(0n),
  notes:          text("notes"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type AcquisitionRow    = typeof assetAcquisitions.$inferSelect;
export type AcquisitionInsert = typeof assetAcquisitions.$inferInsert;
export type TransferRow       = typeof assetTransfers.$inferSelect;
export type TransferInsert    = typeof assetTransfers.$inferInsert;
export type DisposalRow       = typeof assetDisposals.$inferSelect;
export type DisposalInsert    = typeof assetDisposals.$inferInsert;

export const schema = { assetAcquisitions, assetTransfers, assetDisposals };
