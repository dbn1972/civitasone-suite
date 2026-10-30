import {
  pgSchema, uuid, varchar, bigint, integer, text, timestamp, jsonb, date, uniqueIndex,
} from "drizzle-orm/pg-core";

export const medicalSchema = pgSchema("medical");

/**
 * Medical reimbursement / advance claims.
 *
 * Covers indoor (IPD), outdoor (OPD), reimbursement, and advance claims.
 * Amount in paise (bigint). Status: pending → approved / rejected → settled.
 */
export const hrmsMedicalClaims = medicalSchema.table("hrms_medical_claims", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  employeeId:           uuid("employee_id").notNull(),
  claimType:            varchar("claim_type", { length: 32 }).notNull(), // indoor, outdoor, reimbursement, advance
  amountMinor:          bigint("amount_minor", { mode: "bigint" }).notNull(),
  approvedAmountMinor:  bigint("approved_amount_minor", { mode: "bigint" }),
  hospitalName:         varchar("hospital_name", { length: 256 }).notNull(),
  hospitalId:           uuid("hospital_id"),
  diagnosis:            text("diagnosis").notNull(),
  dependantName:        varchar("dependant_name", { length: 128 }),
  dependantRelation:    varchar("dependant_relation", { length: 32 }), // self, spouse, child, parent
  documents:            jsonb("documents").notNull().default([]),
  remarks:              text("remarks"),
  status:               varchar("status", { length: 24 }).notNull().default("pending"), // pending, approved, rejected, settled
  approvedBy:           uuid("approved_by"),
  approvedAt:           timestamp("approved_at", { withTimezone: true }),
  rejectionReason:      text("rejection_reason"),
  version:              integer("version").notNull().default(1),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by").notNull(),
  updatedBy:            uuid("updated_by").notNull(),
});

export type MedicalClaimRow = typeof hrmsMedicalClaims.$inferSelect;
export type MedicalClaimInsert = typeof hrmsMedicalClaims.$inferInsert;

/**
 * Current medical insurance / health scheme record of an employee (migration
 * 0254_hrms_medical_insurance.sql). One row per (tenant, employee).
 *
 * card_number / scheme_id hold the hrms PII envelope ("enc:v2:...", see
 * shared/pii-crypto.ts). They are deliberately plain `text` here rather than
 * the `encryptedText` custom type: the route encrypts BEFORE publishing the
 * command (so plaintext never reaches the queue), the consumer stores the
 * ciphertext as-is, and the read path decrypts per row so one undecryptable
 * row degrades to a masked value instead of failing the whole request.
 */
const employeeSchemaForMedical = pgSchema("employee");

export const medicalInsurance = employeeSchemaForMedical.table("medical_insurance", {
  id:                uuid("id").primaryKey(),
  tenantId:          uuid("tenant_id").notNull(),
  employeeId:        uuid("employee_id").notNull(),
  schemeType:        varchar("scheme_type", { length: 24 }).notNull(), // cghs, state_scheme, group_mediclaim, esic, other
  schemeId:          text("scheme_id"),               // ciphertext envelope
  cardNumber:        text("card_number").notNull(),   // ciphertext envelope
  validityFrom:      date("validity_from", { mode: "string" }).notNull(),
  validityTo:        date("validity_to", { mode: "string" }),
  tier:              varchar("tier", { length: 64 }),
  dependants:        jsonb("dependants").notNull().default([]),
  annualLimitMinor:  bigint("annual_limit_minor", { mode: "bigint" }),
  version:           integer("version").notNull().default(1),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
}, (t) => ({
  tenantEmployeeUniq: uniqueIndex("medical_insurance_tenant_employee_uniq").on(t.tenantId, t.employeeId),
}));

export type MedicalInsuranceRow = typeof medicalInsurance.$inferSelect;

export const schema = { hrmsMedicalClaims, medicalInsurance };
