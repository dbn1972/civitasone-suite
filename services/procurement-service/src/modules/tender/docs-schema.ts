import { pgSchema, uuid, text, integer, boolean, bigint, varchar, timestamp, date } from "drizzle-orm/pg-core";

/** SVC-043 Tender document management — lives in the existing `tender` schema. */
export const tenderDocsSchema = pgSchema("tender");

/** Tender document repository with supersede-based versioning (NIT/RFP/BOQ/…). */
export const procurementTenderDocuments = tenderDocsSchema.table("procurement_tender_documents", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenderId:     uuid("tender_id").notNull(),
  tenantId:     uuid("tenant_id").notNull(),
  docType:      varchar("doc_type", { length: 24 }).notNull().default("other"),
  title:        text("title").notNull(),
  storageRef:   text("storage_ref").notNull(),
  mimeType:     varchar("mime_type", { length: 128 }),
  sizeBytes:    bigint("size_bytes", { mode: "bigint" }),
  docVersion:   integer("doc_version").notNull().default(1),
  isCurrent:    boolean("is_current").notNull().default(true),
  supersedesId: uuid("supersedes_id"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

/** Corrigendum / addendum with republish + optional new bid-closing date. */
export const procurementTenderCorrigenda = tenderDocsSchema.table("procurement_tender_corrigenda", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenderId:          uuid("tender_id").notNull(),
  tenantId:          uuid("tenant_id").notNull(),
  corrigendumNo:     integer("corrigendum_no").notNull(),
  title:             text("title").notNull(),
  description:       text("description"),
  storageRef:        text("storage_ref"),
  newBidClosingDate: date("new_bid_closing_date"),
  isCurrent:         boolean("is_current").notNull().default(true),
  republished:       boolean("republished").notNull().default(false),
  publishedAt:       timestamp("published_at", { withTimezone: true }),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

/** Pre-bid query handling: open → answered → published. */
export const procurementPrebidQueries = tenderDocsSchema.table("procurement_prebid_queries", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenderId:   uuid("tender_id").notNull(),
  tenantId:   uuid("tenant_id").notNull(),
  vendorId:   uuid("vendor_id"),
  queryNo:    integer("query_no").notNull(),
  question:   text("question").notNull(),
  answer:     text("answer"),
  status:     varchar("status", { length: 16 }).notNull().default("open"),
  published:  boolean("published").notNull().default(false),
  answeredBy: uuid("answered_by"),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export type TenderDocRow    = typeof procurementTenderDocuments.$inferSelect;
export type TenderDocInsert = typeof procurementTenderDocuments.$inferInsert;
export type CorrigendumRow    = typeof procurementTenderCorrigenda.$inferSelect;
export type CorrigendumInsert = typeof procurementTenderCorrigenda.$inferInsert;
export type PrebidQueryRow    = typeof procurementPrebidQueries.$inferSelect;
export type PrebidQueryInsert = typeof procurementPrebidQueries.$inferInsert;

export const docsSchema = {
  procurementTenderDocuments,
  procurementTenderCorrigenda,
  procurementPrebidQueries,
};
