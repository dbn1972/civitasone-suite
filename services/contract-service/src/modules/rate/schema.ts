import { pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const rateSchema = pgSchema("rate");

export const contractRateContracts = rateSchema.table("contract_rate_contracts", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  rcNo:       text("rc_no").notNull(),
  vendorId:   uuid("vendor_id").notNull(),
  title:      text("title").notNull(),
  validFrom:  date("valid_from").notNull(),
  validUntil: date("valid_until").notNull(),
  status:     varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const contractRateItems = rateSchema.table("contract_rate_items", {
  id:             uuid("id").primaryKey().defaultRandom(),
  rcId:           uuid("rc_id").notNull(),
  tenantId:       uuid("tenant_id").notNull(),
  itemCode:       text("item_code").notNull(),
  description:    text("description").notNull(),
  unit:           varchar("unit", { length: 32 }).notNull().default("nos"),
  unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type RcRow    = typeof contractRateContracts.$inferSelect;
export type RcInsert = typeof contractRateContracts.$inferInsert;

export const schema = { contractRateContracts, contractRateItems };
