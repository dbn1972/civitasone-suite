import {
  pgSchema, uuid, varchar, bigint, integer, boolean, date, text, timestamp,
} from "drizzle-orm/pg-core";

export const agencySchema = pgSchema("agency");

/** Contract-labour agency / contractor master (CLRA principal-employer register). */
export const hrmsContractors = agencySchema.table("hrms_contractors", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  name:                 varchar("name", { length: 200 }).notNull(),
  contractorKind:       varchar("contractor_kind", { length: 16 }).notNull().default("other"),
  clraLicenseNo:        varchar("clra_license_no", { length: 64 }),
  clraLicenseValidTill: date("clra_license_valid_till"),
  pan:                  varchar("pan", { length: 10 }),
  gstin:                varchar("gstin", { length: 15 }),
  contactEmail:         varchar("contact_email", { length: 120 }),
  contactPhone:         varchar("contact_phone", { length: 20 }),
  status:               varchar("status", { length: 16 }).notNull().default("active"),
  version:              integer("version").notNull().default(1),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by").notNull(),
  updatedBy:            uuid("updated_by").notNull(),
});

/** Contractor bill (194C + optional GST + CLRA wage-disbursement attestation). */
export const hrmsContractorBills = agencySchema.table("hrms_contractor_bills", {
  id:                     uuid("id").primaryKey().defaultRandom(),
  tenantId:               uuid("tenant_id").notNull(),
  contractorId:           uuid("contractor_id").notNull(),
  billNo:                 varchar("bill_no", { length: 64 }).notNull(),
  billDate:               date("bill_date").notNull(),
  periodFrom:             date("period_from"),
  periodTo:               date("period_to"),
  description:            text("description"),
  workersCount:           integer("workers_count").notNull().default(0),
  wagesDisbursedVerified: boolean("wages_disbursed_verified").notNull().default(false),
  currency:               varchar("currency", { length: 3 }).notNull().default("INR"),
  grossMinor:             bigint("gross_minor", { mode: "bigint" }).notNull(),
  gstApplicable:          boolean("gst_applicable").notNull().default(false),
  gstRateBps:             integer("gst_rate_bps").notNull().default(0),
  gstMinor:               bigint("gst_minor", { mode: "bigint" }).notNull().default(0n),
  gstin:                  varchar("gstin", { length: 15 }),
  tdsSection:             varchar("tds_section", { length: 8 }).notNull().default("194C"),
  tdsRateBps:             integer("tds_rate_bps").notNull().default(0),
  tdsMinor:               bigint("tds_minor", { mode: "bigint" }).notNull().default(0n),
  netPayableMinor:        bigint("net_payable_minor", { mode: "bigint" }).notNull().default(0n),
  status:                 varchar("status", { length: 16 }).notNull().default("submitted"),
  remarks:                text("remarks"),
  approverRemarks:        text("approver_remarks"),
  paymentRef:             varchar("payment_ref", { length: 64 }),
  submittedAt:            timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedBy:             uuid("verified_by"),
  verifiedAt:             timestamp("verified_at", { withTimezone: true }),
  approvedBy:             uuid("approved_by"),
  approvedAt:             timestamp("approved_at", { withTimezone: true }),
  paidAt:                 timestamp("paid_at", { withTimezone: true }),
  version:                integer("version").notNull().default(1),
  createdAt:              timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:              timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:              uuid("created_by").notNull(),
  updatedBy:              uuid("updated_by").notNull(),
});

export type ContractorRow = typeof hrmsContractors.$inferSelect;
export type ContractorInsert = typeof hrmsContractors.$inferInsert;
export type ContractorBillRow = typeof hrmsContractorBills.$inferSelect;
export type ContractorBillInsert = typeof hrmsContractorBills.$inferInsert;

export const schema = { hrmsContractors, hrmsContractorBills };
