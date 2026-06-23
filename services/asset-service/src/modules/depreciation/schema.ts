import {
  pgSchema, uuid, text, integer, bigint, char, varchar, date, numeric, timestamp,
} from "drizzle-orm/pg-core";

export const depSchema = pgSchema("depreciation");

export const assetDepSchedules = depSchema.table("asset_dep_schedules", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  assetId:          uuid("asset_id").notNull(),
  method:           varchar("method", { length: 8 }).notNull().default("SLM"),
  rate:             numeric("rate", { precision: 8, scale: 4 }).notNull(),
  usefulLifeYears:  integer("useful_life_years").notNull(),
  startDate:        date("start_date").notNull(),
  endDate:          date("end_date").notNull(),
  originalCostMinor:bigint("original_cost_minor", { mode: "bigint" }).notNull(),
  salvageMinor:     bigint("salvage_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  status:           varchar("status", { length: 16 }).notNull().default("active"),
  depBook:          varchar("dep_book", { length: 16 }).notNull().default("company"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const assetDepEntries = depSchema.table("asset_dep_entries", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  assetId:             uuid("asset_id").notNull(),
  scheduleId:          uuid("schedule_id").notNull(),
  period:              char("period", { length: 7 }).notNull(),
  amountMinor:         bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency:            char("currency", { length: 3 }).notNull().default("INR"),
  bookValueAfterMinor: bigint("book_value_after_minor", { mode: "bigint" }).notNull(),
  depBook:             varchar("dep_book", { length: 16 }).notNull().default("company"),
  postedAt:            timestamp("posted_at", { withTimezone: true }),
  glRef:               text("gl_ref"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export type DepScheduleRow    = typeof assetDepSchedules.$inferSelect;
export type DepScheduleInsert = typeof assetDepSchedules.$inferInsert;
export type DepEntryRow       = typeof assetDepEntries.$inferSelect;
export type DepEntryInsert    = typeof assetDepEntries.$inferInsert;

export const schema = { assetDepSchedules, assetDepEntries };
