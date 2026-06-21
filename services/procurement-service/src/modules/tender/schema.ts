import { pgSchema, uuid, text, integer, bigint, char, varchar, date, timestamp } from "drizzle-orm/pg-core";

export const tenderSchema = pgSchema("tender");

export const procurementTenders = tenderSchema.table("procurement_tenders", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  tenderNo:       text("tender_no").notNull(),
  title:          text("title").notNull(),
  scope:          text("scope"),
  eligibility:    text("eligibility"),
  type:           varchar("type", { length: 16 }).notNull().default("open"),
  estimatedMinor: bigint("estimated_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  publishDate:    date("publish_date"),
  bidClosingDate: date("bid_closing_date").notNull().defaultNow(),
  openingDate:    date("opening_date"),
  bidsReceived:   integer("bids_received").notNull().default(0),
  status:         varchar("status", { length: 16 }).notNull().default("draft"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const procurementTenderBids = tenderSchema.table("procurement_tender_bids", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenderId:       uuid("tender_id").notNull(),
  tenantId:       uuid("tenant_id").notNull(),
  vendorId:       uuid("vendor_id").notNull(),
  vendorName:     text("vendor_name").notNull().default(""),
  bidAmount:      bigint("bid_amount", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  technicalScore: integer("technical_score"),
  financialScore: integer("financial_score"),
  status:         varchar("status", { length: 16 }).notNull().default("submitted"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type TenderRow    = typeof procurementTenders.$inferSelect;
export type TenderInsert = typeof procurementTenders.$inferInsert;

export const schema = { procurementTenders, procurementTenderBids };
