import {
  pgSchema, uuid, varchar, bigint, integer, date, text, timestamp,
} from "drizzle-orm/pg-core";

export const claimsSchema = pgSchema("claims");

/** LTC (Leave Travel Concession) fare-reimbursement claim. */
export const hrmsLtcClaims = claimsSchema.table("hrms_ltc_claims", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  employeeId:         uuid("employee_id").notNull(),
  blockYear:          varchar("block_year", { length: 16 }).notNull(),
  ltcType:            varchar("ltc_type", { length: 16 }).notNull(), // hometown | all_india
  journeyFrom:        varchar("journey_from", { length: 120 }).notNull(),
  journeyTo:          varchar("journey_to", { length: 120 }).notNull(),
  travelDate:         date("travel_date").notNull(),
  familyMembers:      integer("family_members").notNull().default(1),
  claimedFareMinor:   bigint("claimed_fare_minor", { mode: "bigint" }).notNull(),
  entitlementMinor:   bigint("entitlement_minor", { mode: "bigint" }).notNull(),
  approvedFareMinor:  bigint("approved_fare_minor", { mode: "bigint" }),
  status:             varchar("status", { length: 16 }).notNull().default("submitted"),
  remarks:            text("remarks"),
  approverRemarks:    text("approver_remarks"),
  submittedAt:        timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt:          timestamp("decided_at", { withTimezone: true }),
  decidedBy:          uuid("decided_by"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

/** CEA (Children Education Allowance) claim — tuition or hostel subsidy. */
export const hrmsCeaClaims = claimsSchema.table("hrms_cea_claims", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  employeeId:          uuid("employee_id").notNull(),
  academicYear:        varchar("academic_year", { length: 16 }).notNull(),
  childName:           varchar("child_name", { length: 120 }).notNull(),
  childRef:            varchar("child_ref", { length: 64 }).notNull(),
  claimKind:           varchar("claim_kind", { length: 16 }).notNull(), // tuition | hostel
  claimedAmountMinor:  bigint("claimed_amount_minor", { mode: "bigint" }).notNull(),
  annualCapMinor:      bigint("annual_cap_minor", { mode: "bigint" }).notNull(),
  approvedAmountMinor: bigint("approved_amount_minor", { mode: "bigint" }),
  status:              varchar("status", { length: 16 }).notNull().default("submitted"),
  remarks:             text("remarks"),
  approverRemarks:     text("approver_remarks"),
  submittedAt:         timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt:           timestamp("decided_at", { withTimezone: true }),
  decidedBy:           uuid("decided_by"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export type LtcClaimRow = typeof hrmsLtcClaims.$inferSelect;
export type LtcClaimInsert = typeof hrmsLtcClaims.$inferInsert;
export type CeaClaimRow = typeof hrmsCeaClaims.$inferSelect;
export type CeaClaimInsert = typeof hrmsCeaClaims.$inferInsert;

export const schema = { hrmsLtcClaims, hrmsCeaClaims };
