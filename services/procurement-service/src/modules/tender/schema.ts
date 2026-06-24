import { pgSchema, uuid, text, integer, bigint, char, varchar, date, timestamp, boolean } from "drizzle-orm/pg-core";

export const tenderSchema = pgSchema("tender");

export const procurementTenders = tenderSchema.table("procurement_tenders", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  tenderNo:        text("tender_no").notNull(),
  title:           text("title").notNull(),
  scope:           text("scope"),
  eligibility:     text("eligibility"),
  type:            varchar("type", { length: 16 }).notNull().default("open"),
  estimatedMinor:  bigint("estimated_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  nitRef:          text("nit_ref"),
  emdAmountMinor:  bigint("emd_amount_minor", { mode: "bigint" }).notNull().default(0n),
  publishDate:     date("publish_date"),
  bidClosingDate:  date("bid_closing_date").notNull().defaultNow(),
  openingDate:     date("opening_date"),
  bidsReceived:    integer("bids_received").notNull().default(0),
  status:          varchar("status", { length: 24 }).notNull().default("draft"),
  awardedBidId:    uuid("awarded_bid_id"),
  awardedVendorId: uuid("awarded_vendor_id"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

// Technical envelope + qualification state. Financial value is NOT stored here;
// it lives sealed in procurementTenderFinancialBids until the envelope is opened.
export const procurementTenderBids = tenderSchema.table("procurement_tender_bids", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenderId:           uuid("tender_id").notNull(),
  tenantId:           uuid("tenant_id").notNull(),
  vendorId:           uuid("vendor_id").notNull(),
  vendorName:         text("vendor_name").notNull().default(""),
  bidNo:              text("bid_no"),
  bidAmount:          bigint("bid_amount", { mode: "bigint" }).notNull().default(0n),
  currency:           char("currency", { length: 3 }).notNull().default("INR"),
  technicalScore:     integer("technical_score"),
  technicalQualified: boolean("technical_qualified"),
  qualificationNotes: text("qualification_notes"),
  financialOpened:    boolean("financial_opened").notNull().default(false),
  financialScore:     integer("financial_score"),
  rank:               integer("rank"),
  isL1:               boolean("is_l1").notNull().default(false),
  status:             varchar("status", { length: 24 }).notNull().default("submitted"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

// SEALED financial envelope — separate table. Read paths for technical eval and
// generic bid listing MUST NOT join this table while sealed=true.
export const procurementTenderFinancialBids = tenderSchema.table("procurement_tender_financial_bids", {
  id:          uuid("id").primaryKey().defaultRandom(),
  bidId:       uuid("bid_id").notNull(),
  tenderId:    uuid("tender_id").notNull(),
  tenantId:    uuid("tenant_id").notNull(),
  vendorId:    uuid("vendor_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  sealed:      boolean("sealed").notNull().default(true),
  openedAt:    timestamp("opened_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type TenderRow    = typeof procurementTenders.$inferSelect;
export type TenderInsert = typeof procurementTenders.$inferInsert;
export type TenderBidRow    = typeof procurementTenderBids.$inferSelect;
export type TenderBidInsert = typeof procurementTenderBids.$inferInsert;
export type FinancialBidRow    = typeof procurementTenderFinancialBids.$inferSelect;
export type FinancialBidInsert = typeof procurementTenderFinancialBids.$inferInsert;

export const schema = { procurementTenders, procurementTenderBids, procurementTenderFinancialBids };
