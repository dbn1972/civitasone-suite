/**
 * MSME commercial M2 (migrations 0176-0178): drizzle mirror of the NEW `ar` schema -- customer master, sales invoices,
 * advance receipts, credit / debit notes and the AR sub-ledger. Every table is RLS-scoped (tenant policy, FORCE); money is paise
 * (bigint). There is no db/schema.sql or Alembic in finance-service: migrations + this file are the source of truth.
 * gl.finance_ar_ledger (platform-billing AR) is not mirrored or touched here.
 */
import { pgSchema, uuid, text, varchar, bigint, date, integer, timestamp, char, boolean, numeric, smallint } from "drizzle-orm/pg-core";

const arSchema = pgSchema("ar");

export const INVOICE_STATUSES = ["draft", "issued"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const SUPPLY_TYPES = ["intra", "inter", "none"] as const;
export type SupplyType = (typeof SUPPLY_TYPES)[number];
export const NOTE_TYPES = ["credit", "debit"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export const NOTE_REASONS = [
  "sales_return", "post_sale_discount", "deficiency_in_service", "correction_in_invoice",
  "change_in_place_of_supply", "finalisation_of_provisional_assessment", "others",
] as const;
export type NoteReason = (typeof NOTE_REASONS)[number];
export const LEDGER_ENTRY_TYPES = ["invoice", "debit_note", "credit_note", "advance_adjustment", "receipt"] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const arCustomers = arSchema.table("customers", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  customerCode:     varchar("customer_code", { length: 32 }).notNull(),
  name:             text("name").notNull(),
  gstin:            varchar("gstin", { length: 15 }),
  stateCode:        char("state_code", { length: 2 }).notNull(),
  pan:              varchar("pan", { length: 10 }),
  address:          text("address"),
  email:            text("email"),
  phone:            text("phone"),
  creditDays:       integer("credit_days").notNull().default(0),
  creditLimitMinor: bigint("credit_limit_minor", { mode: "bigint" }),
  isActive:         boolean("is_active").notNull().default(true),
  createdBy:        uuid("created_by").notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:        uuid("updated_by").notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:          integer("version").notNull().default(1),
});
export type ArCustomerRow = typeof arCustomers.$inferSelect;

export const arDocCounters = arSchema.table("doc_counters", {
  tenantId:  uuid("tenant_id").notNull(),
  docType:   varchar("doc_type", { length: 24 }).notNull(),
  bucket:    varchar("bucket", { length: 16 }).notNull(),
  lastSeq:   bigint("last_seq", { mode: "bigint" }).notNull().default(0n),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const salesInvoices = arSchema.table("sales_invoices", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  invoiceNo:           varchar("invoice_no", { length: 16 }),
  status:              varchar("status", { length: 10 }).$type<InvoiceStatus>().notNull().default("draft"),
  customerId:          uuid("customer_id").notNull(),
  customerName:        text("customer_name").notNull(),
  customerGstin:       varchar("customer_gstin", { length: 15 }),
  supplierGstin:       varchar("supplier_gstin", { length: 15 }),
  invoiceDate:         date("invoice_date").notNull(),
  supplyDate:          date("supply_date").notNull(),
  timeOfSupply:        date("time_of_supply").notNull(),
  dueDate:             date("due_date").notNull(),
  placeOfSupply:       char("place_of_supply", { length: 2 }).notNull(),
  supplyType:          varchar("supply_type", { length: 5 }).$type<SupplyType>().notNull(),
  invoiceType:         varchar("invoice_type", { length: 3 }).$type<"B2B" | "B2C">().notNull(),
  reverseCharge:       boolean("reverse_charge").notNull().default(false),
  currency:            char("currency", { length: 3 }).notNull().default("INR"),
  taxableMinor:        bigint("taxable_minor", { mode: "bigint" }).notNull(),
  cgstMinor:           bigint("cgst_minor", { mode: "bigint" }).notNull().default(0n),
  sgstMinor:           bigint("sgst_minor", { mode: "bigint" }).notNull().default(0n),
  igstMinor:           bigint("igst_minor", { mode: "bigint" }).notNull().default(0n),
  cessMinor:           bigint("cess_minor", { mode: "bigint" }).notNull().default(0n),
  taxMinor:            bigint("tax_minor", { mode: "bigint" }).notNull(),
  totalMinor:          bigint("total_minor", { mode: "bigint" }).notNull(),
  advanceAdjustedMinor: bigint("advance_adjusted_minor", { mode: "bigint" }).notNull().default(0n),
  narration:           text("narration"),
  journalId:           uuid("journal_id"),
  issuedAt:            timestamp("issued_at", { withTimezone: true }),
  issuedBy:            uuid("issued_by"),
  source:              varchar("source", { length: 8 }).$type<"api" | "mobile">().notNull().default("api"),
  clientRef:           text("client_ref"),
  createdBy:           uuid("created_by").notNull(),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:           uuid("updated_by").notNull(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:             integer("version").notNull().default(1),
});
export type SalesInvoiceRow = typeof salesInvoices.$inferSelect;

export const salesInvoiceLines = arSchema.table("sales_invoice_lines", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  invoiceId:       uuid("invoice_id").notNull(),
  lineNo:          smallint("line_no").notNull(),
  description:     text("description").notNull(),
  hsnSac:          varchar("hsn_sac", { length: 8 }),
  qty:             numeric("qty", { precision: 14, scale: 3 }).notNull(),
  uom:             varchar("uom", { length: 8 }),
  rateMinor:       bigint("rate_minor", { mode: "bigint" }).notNull(),
  discountMinor:   bigint("discount_minor", { mode: "bigint" }).notNull().default(0n),
  taxableMinor:    bigint("taxable_minor", { mode: "bigint" }).notNull(),
  gstRatePct:      numeric("gst_rate_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  gstRateMasterId: uuid("gst_rate_master_id"),
  taxMinor:        bigint("tax_minor", { mode: "bigint" }).notNull(),
  totalMinor:      bigint("total_minor", { mode: "bigint" }).notNull(),
});
export type SalesInvoiceLineRow = typeof salesInvoiceLines.$inferSelect;

export const advanceReceipts = arSchema.table("advance_receipts", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  receiptNo:         varchar("receipt_no", { length: 16 }).notNull(),
  customerId:        uuid("customer_id").notNull(),
  receiptDate:       date("receipt_date").notNull(),
  placeOfSupply:     char("place_of_supply", { length: 2 }).notNull(),
  supplyType:        varchar("supply_type", { length: 5 }).$type<SupplyType>().notNull(),
  amountMinor:       bigint("amount_minor", { mode: "bigint" }).notNull(),
  gstRatePct:        numeric("gst_rate_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  taxableMinor:      bigint("taxable_minor", { mode: "bigint" }).notNull(),
  cgstMinor:         bigint("cgst_minor", { mode: "bigint" }).notNull().default(0n),
  sgstMinor:         bigint("sgst_minor", { mode: "bigint" }).notNull().default(0n),
  igstMinor:         bigint("igst_minor", { mode: "bigint" }).notNull().default(0n),
  taxMinor:          bigint("tax_minor", { mode: "bigint" }).notNull(),
  paymentMode:       varchar("payment_mode", { length: 16 }),
  reference:         text("reference"),
  status:            varchar("status", { length: 10 }).$type<"open" | "adjusted">().notNull().default("open"),
  adjustedInvoiceId: uuid("adjusted_invoice_id"),
  createdBy:         uuid("created_by").notNull(),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:         uuid("updated_by").notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AdvanceReceiptRow = typeof advanceReceipts.$inferSelect;

export const creditDebitNotes = arSchema.table("credit_debit_notes", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  noteNo:         varchar("note_no", { length: 16 }),
  noteType:       varchar("note_type", { length: 6 }).$type<NoteType>().notNull(),
  status:         varchar("status", { length: 10 }).$type<InvoiceStatus>().notNull().default("draft"),
  invoiceId:      uuid("invoice_id").notNull(),
  customerId:     uuid("customer_id").notNull(),
  noteDate:       date("note_date").notNull(),
  reason:         varchar("reason", { length: 40 }).$type<NoteReason>().notNull(),
  reasonText:     text("reason_text"),
  /** M3b: the GST rate the note was computed at (needed to post its per-rate output gst rows); NULL for a none-supply note. */
  gstRatePct:     numeric("gst_rate_pct", { precision: 5, scale: 2 }),
  supplyType:     varchar("supply_type", { length: 5 }).$type<SupplyType>().notNull(),
  taxableMinor:   bigint("taxable_minor", { mode: "bigint" }).notNull(),
  cgstMinor:      bigint("cgst_minor", { mode: "bigint" }).notNull().default(0n),
  sgstMinor:      bigint("sgst_minor", { mode: "bigint" }).notNull().default(0n),
  igstMinor:      bigint("igst_minor", { mode: "bigint" }).notNull().default(0n),
  cessMinor:      bigint("cess_minor", { mode: "bigint" }).notNull().default(0n),
  taxMinor:       bigint("tax_minor", { mode: "bigint" }).notNull(),
  totalMinor:     bigint("total_minor", { mode: "bigint" }).notNull(),
  s34CutoffDate:  date("s34_cutoff_date").notNull(),
  withinS34Window: boolean("within_s34_window").notNull(),
  journalId:      uuid("journal_id"),
  issuedAt:       timestamp("issued_at", { withTimezone: true }),
  issuedBy:       uuid("issued_by"),
  createdBy:      uuid("created_by").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:      uuid("updated_by").notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:        integer("version").notNull().default(1),
});
export type CreditDebitNoteRow = typeof creditDebitNotes.$inferSelect;

export const arLedgerEntries = arSchema.table("ledger_entries", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  customerId:  uuid("customer_id").notNull(),
  invoiceId:   uuid("invoice_id").notNull(),
  entryType:   varchar("entry_type", { length: 20 }).$type<LedgerEntryType>().notNull(),
  sourceDocId: uuid("source_doc_id").notNull(),
  sourceDocNo: varchar("source_doc_no", { length: 16 }).notNull(),
  entryDate:   date("entry_date").notNull(),
  dueDate:     date("due_date").notNull(),
  debitMinor:  bigint("debit_minor", { mode: "bigint" }).notNull().default(0n),
  creditMinor: bigint("credit_minor", { mode: "bigint" }).notNull().default(0n),
  journalId:   uuid("journal_id"),
  createdBy:   uuid("created_by").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ArLedgerEntryRow = typeof arLedgerEntries.$inferSelect;

export const schema = { arCustomers, arDocCounters, salesInvoices, salesInvoiceLines, advanceReceipts, creditDebitNotes, arLedgerEntries };
