import {
  pgSchema, uuid, varchar, bigint, integer, text, timestamp, jsonb,
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

export const schema = { hrmsMedicalClaims };
