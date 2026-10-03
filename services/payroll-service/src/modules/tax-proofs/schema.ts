import { pgSchema, uuid, char, varchar, bigint, boolean, text, timestamp } from "drizzle-orm/pg-core";

const payrollSchema = pgSchema("payroll");

/** GAP-PAYROLL-TAX-DECLARATION-02 -- see migration 0079. */
export const taxProofs = payrollSchema.table("tax_proofs", {
  id:               uuid("id").primaryKey(),
  tenantId:         uuid("tenant_id").notNull(),
  employeeId:       uuid("employee_id").notNull(),
  fy:               char("fy", { length: 7 }).notNull(),
  line:             varchar("line", { length: 24 }).notNull(),
  storageKey:       text("storage_key").notNull(),
  filename:         varchar("filename", { length: 200 }).notNull(),
  contentType:      varchar("content_type", { length: 64 }).notNull(),
  sizeBytes:        bigint("size_bytes", { mode: "number" }).notNull(),
  amountMinor:      bigint("amount_minor", { mode: "bigint" }),
  status:           varchar("status", { length: 12 }).notNull().default("pending"),
  rejectionReason:  varchar("rejection_reason", { length: 500 }),
  decidedBy:        uuid("decided_by"),
  decidedAt:        timestamp("decided_at", { withTimezone: true }),
  legalHold:        boolean("legal_hold").notNull().default(false),
  legalHoldReason:  varchar("legal_hold_reason", { length: 500 }),
  legalHoldBy:      uuid("legal_hold_by"),
  legalHoldAt:      timestamp("legal_hold_at", { withTimezone: true }),
  uploadedBy:       uuid("uploaded_by").notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  removedAt:        timestamp("removed_at", { withTimezone: true }),
});

export const schema = { taxProofs };
