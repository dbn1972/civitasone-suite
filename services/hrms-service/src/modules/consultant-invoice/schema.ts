import {
  pgSchema, uuid, varchar, bigint, integer, boolean, date, text, timestamp,
} from "drizzle-orm/pg-core";

export const consultantSchema = pgSchema("consultant");

/** Consultant professional-services invoice (194J + optional GST). */
export const hrmsConsultantInvoices = consultantSchema.table("hrms_consultant_invoices", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  consultantId:     uuid("consultant_id").notNull(),
  invoiceNo:        varchar("invoice_no", { length: 64 }).notNull(),
  invoiceDate:      date("invoice_date").notNull(),
  periodFrom:       date("period_from"),
  periodTo:         date("period_to"),
  description:      text("description"),
  currency:         varchar("currency", { length: 3 }).notNull().default("INR"),
  grossMinor:       bigint("gross_minor", { mode: "bigint" }).notNull(),
  gstApplicable:    boolean("gst_applicable").notNull().default(false),
  gstRateBps:       integer("gst_rate_bps").notNull().default(0),
  gstMinor:         bigint("gst_minor", { mode: "bigint" }).notNull().default(0n),
  gstin:            varchar("gstin", { length: 15 }),
  sacCode:          varchar("sac_code", { length: 6 }),
  tdsSection:       varchar("tds_section", { length: 8 }).notNull().default("194J"),
  tdsRateBps:       integer("tds_rate_bps").notNull().default(1000),
  tdsMinor:         bigint("tds_minor", { mode: "bigint" }).notNull().default(0n),
  netPayableMinor:  bigint("net_payable_minor", { mode: "bigint" }).notNull().default(0n),
  status:           varchar("status", { length: 16 }).notNull().default("submitted"),
  remarks:          text("remarks"),
  approverRemarks:  text("approver_remarks"),
  paymentRef:       varchar("payment_ref", { length: 64 }),
  submittedAt:      timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedBy:       uuid("verified_by"),
  verifiedAt:       timestamp("verified_at", { withTimezone: true }),
  approvedBy:       uuid("approved_by"),
  approvedAt:       timestamp("approved_at", { withTimezone: true }),
  paidAt:           timestamp("paid_at", { withTimezone: true }),
  version:          integer("version").notNull().default(1),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
});

export type ConsultantInvoiceRow = typeof hrmsConsultantInvoices.$inferSelect;
export type ConsultantInvoiceInsert = typeof hrmsConsultantInvoices.$inferInsert;

export const schema = { hrmsConsultantInvoices };
