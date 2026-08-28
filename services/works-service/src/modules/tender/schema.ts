import { pgSchema, uuid, varchar, integer, bigint, timestamp } from "drizzle-orm/pg-core";
import { contractors } from "../contractor/schema.js";

const works = pgSchema("works");

export const preTenders = works.table("pre_tenders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  referenceNumber: varchar("reference_number", { length: 128 }),
  tenderType: varchar("tender_type", { length: 64 }),
  covers: integer("covers"),
  tenderCategory: varchar("tender_category", { length: 64 }),
  productCategory: varchar("product_category", { length: 64 }),
  bidOpeners: integer("bid_openers"),
  contractForm: varchar("contract_form", { length: 64 }),
  bidValidity: integer("bid_validity"),
  tenderClass: varchar("tender_class", { length: 64 }),
  fees: bigint("fees", { mode: "bigint" }),
  publicationDate: timestamp("publication_date", { withTimezone: true }),
  downloadDate: timestamp("download_date", { withTimezone: true }),
  clarificationDate: timestamp("clarification_date", { withTimezone: true }),
  bidSubmissionDate: timestamp("bid_submission_date", { withTimezone: true }),
  openingDate: timestamp("opening_date", { withTimezone: true }),
  status: varchar("status", { length: 32 }).notNull().default("draft"), // draft|finalized|pushed|transferred
  transferredTo: varchar("transferred_to", { length: 256 }),
  gepnicRef: varchar("gepnic_ref", { length: 128 }),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenders = works.table("tenders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  tenderTypeId: uuid("tender_type_id"),
  tenderAmountMinor: bigint("tender_amount_minor", { mode: "bigint" }).notNull(),
  openingDate: timestamp("opening_date", { withTimezone: true }),
  approvingAuthorityId: uuid("approving_authority_id"),
  contractorClassId: uuid("contractor_class_id"),
  remarks: varchar("remarks", { length: 2048 }),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quotations = works.table("quotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  tenderId: uuid("tender_id").notNull(),
  contractorName: varchar("contractor_name", { length: 256 }).notNull(),
  method: varchar("method", { length: 32 }).notNull(), // percentage_rate | item_rate
  quotedAmountMinor: bigint("quoted_amount_minor", { mode: "bigint" }),
  quotedPercentage: varchar("quoted_percentage", { length: 16 }),
  aboveOrBelowOrAtPar: varchar("above_or_below_or_at_par", { length: 16 }),
  version: integer("version").notNull().default(1),
});

export const quotationItems = works.table("quotation_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  quotationId: uuid("quotation_id").notNull(),
  boqItemId: uuid("boq_item_id").notNull(),
  contractorRate: bigint("contractor_rate", { mode: "bigint" }).notNull(),
  comparison: varchar("comparison", { length: 64 }),
  version: integer("version").notNull().default(1),
});

export const awards = works.table("awards", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  contractorName: varchar("contractor_name", { length: 256 }).notNull(),
  // Structured link to works.contractors — nullable for back-compat with
  // rows created before this column existed, but application code requires
  // it to resolve to (or be validated against) a real contractor record on
  // every new award. See billing-integrity fix #4.
  contractorId: uuid("contractor_id").references(() => contractors.id),
  agreementNumber: varchar("agreement_number", { length: 128 }),
  workOrderNumber: varchar("work_order_number", { length: 128 }),
  agreementDate: timestamp("agreement_date", { withTimezone: true }),
  authorityId: uuid("authority_id"),
  actualCommencement: timestamp("actual_commencement", { withTimezone: true }),
  workPeriodDays: integer("work_period_days"),
  stipulatedCompletion: timestamp("stipulated_completion", { withTimezone: true }),
  agreementType: varchar("agreement_type", { length: 64 }),
  billMode: varchar("bill_mode", { length: 16 }), // abstract | e_mb
  acceptedAmountMinor: bigint("accepted_amount_minor", { mode: "bigint" }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("draft"), // draft|dao_finalized|do_finalized
  daoFinalizedBy: uuid("dao_finalized_by"),
  daoFinalizedAt: timestamp("dao_finalized_at", { withTimezone: true }),
  doFinalizedBy: uuid("do_finalized_by"),
  doFinalizedAt: timestamp("do_finalized_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { preTenders, tenders, quotations, quotationItems, awards };
