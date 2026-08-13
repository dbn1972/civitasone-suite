import {
  pgSchema, uuid, text, integer, bigint, char, varchar, date, timestamp, jsonb, numeric,
} from "drizzle-orm/pg-core";

export const waterMeteringSchema = pgSchema("water_metering");

export const assetWaterMeterReadings = waterMeteringSchema.table("asset_water_meter_readings", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  connectionId:    uuid("connection_id").notNull(),
  readingDate:     date("reading_date").notNull(),
  previousReading: numeric("previous_reading").notNull(),
  currentReading:  numeric("current_reading").notNull(),
  consumption:     numeric("consumption").notNull(),
  unit:            varchar("unit", { length: 16 }).notNull().default("kl"),
  readerId:        uuid("reader_id"),
  photo:           text("photo"),
  status:          varchar("status", { length: 16 }).notNull().default("pending"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const assetWaterBills = waterMeteringSchema.table("asset_water_bills", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  connectionId:   uuid("connection_id").notNull(),
  billNumber:     text("bill_number").notNull(),
  billingPeriod:  varchar("billing_period", { length: 32 }),
  readingId:      uuid("reading_id"),
  consumptionKl:  numeric("consumption_kl").notNull(),
  ratePerKl:      bigint("rate_per_kl", { mode: "bigint" }).notNull(),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  taxMinor:       bigint("tax_minor", { mode: "bigint" }).notNull().default(0n),
  totalMinor:     bigint("total_minor", { mode: "bigint" }).notNull(),
  dueDate:        date("due_date").notNull(),
  status:         varchar("status", { length: 16 }).notNull().default("generated"),
  paymentDate:    timestamp("payment_date", { withTimezone: true }),
  paymentRef:     text("payment_ref"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const assetWaterServiceRequests = waterMeteringSchema.table("asset_water_service_requests", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  requestType:  varchar("request_type", { length: 32 }).notNull(),
  description:  text("description"),
  status:       varchar("status", { length: 16 }).notNull().default("open"),
  assignedTo:   uuid("assigned_to"),
  resolvedAt:   timestamp("resolved_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type WaterMeterReadingRow    = typeof assetWaterMeterReadings.$inferSelect;
export type WaterMeterReadingInsert = typeof assetWaterMeterReadings.$inferInsert;
export type WaterBillRow            = typeof assetWaterBills.$inferSelect;
export type WaterBillInsert         = typeof assetWaterBills.$inferInsert;
export type WaterServiceRequestRow    = typeof assetWaterServiceRequests.$inferSelect;
export type WaterServiceRequestInsert = typeof assetWaterServiceRequests.$inferInsert;

export const schema = { assetWaterMeterReadings, assetWaterBills, assetWaterServiceRequests };
