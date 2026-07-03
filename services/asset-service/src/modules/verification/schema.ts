import { pgSchema, uuid, text, varchar, boolean, integer, jsonb, timestamp, date } from "drizzle-orm/pg-core";

export const verificationSchema = pgSchema("lifecycle");

export const physicalVerifications = verificationSchema.table("physical_verifications", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  verificationDate: date("verification_date").notNull(),
  verifiedBy:       uuid("verified_by").notNull(),
  status:           varchar("status", { length: 20 }).notNull().default("draft"),
  committeeMembers: jsonb("committee_members").default([]),
  approvedBy:       uuid("approved_by"),
  approvedAt:       timestamp("approved_at", { withTimezone: true }),
  notes:            text("notes"),
  version:          integer("version").notNull().default(1),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const physicalVerificationItems = verificationSchema.table("physical_verification_items", {
  id:              uuid("id").primaryKey().defaultRandom(),
  verificationId:  uuid("verification_id").notNull(),
  assetId:         uuid("asset_id").notNull(),
  tenantId:        uuid("tenant_id").notNull(),
  condition:       varchar("condition", { length: 20 }).notNull(),
  foundAtLocation: boolean("found_at_location").default(true),
  remarks:         text("remarks"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const writeoffApprovals = verificationSchema.table("writeoff_approvals", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  assetId:          uuid("asset_id").notNull(),
  requestedBy:      uuid("requested_by").notNull(),
  status:           varchar("status", { length: 20 }).default("pending"),
  committeeRemarks: text("committee_remarks"),
  approvedBy:       uuid("approved_by"),
  approvedAt:       timestamp("approved_at", { withTimezone: true }),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { physicalVerifications, physicalVerificationItems, writeoffApprovals };
