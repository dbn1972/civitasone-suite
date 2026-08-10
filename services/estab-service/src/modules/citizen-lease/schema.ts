/**
 * citizen-lease module — Municipal property leasing for citizens (BRD 5.26 ESTATE-001…004).
 *
 * Tables:
 *   estab_lease_properties   — leasable property inventory (shops, stalls, plots)
 *   estab_leases             — active lease agreements
 *   estab_lease_payments     — monthly rent payment records
 *   estab_lease_requests     — renewal/transfer/surrender/no-dues requests
 *
 * PG Schema: `citizen_lease`
 * All money as bigint paise. Optimistic locking via `version`.
 */
import {
  pgSchema, uuid, text, varchar, integer, bigint, char, boolean, date, timestamp, jsonb, numeric,
} from "drizzle-orm/pg-core";

export const citizenLeaseSchema = pgSchema("citizen_lease");

export const estabLeaseProperties = citizenLeaseSchema.table("estab_lease_properties", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  propertyCode:     text("property_code").notNull().unique(),
  propertyType:     varchar("property_type", { length: 24 }).notNull(),
  location:         jsonb("location"),
  area:             numeric("area", { precision: 12, scale: 2 }),
  areaUnit:         varchar("area_unit", { length: 16 }).notNull().default("sqft"),
  monthlyRentMinor: bigint("monthly_rent_minor", { mode: "bigint" }).notNull(),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  leaseTermMonths:  integer("lease_term_months"),
  status:           varchar("status", { length: 24 }).notNull().default("available"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const estabLeases = citizenLeaseSchema.table("estab_leases", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  leaseNumber:         text("lease_number").notNull(),
  propertyId:          uuid("property_id").notNull(),
  tenantName:          text("tenant_name").notNull(),
  tenantPhone:         varchar("tenant_phone", { length: 15 }).notNull(),
  tenantAadhaar:       varchar("tenant_aadhaar", { length: 12 }),
  tenantAddress:       jsonb("tenant_address"),
  leaseStartDate:      date("lease_start_date").notNull(),
  leaseEndDate:        date("lease_end_date").notNull(),
  monthlyRentMinor:    bigint("monthly_rent_minor", { mode: "bigint" }).notNull(),
  securityDepositMinor: bigint("security_deposit_minor", { mode: "bigint" }),
  currency:            char("currency", { length: 3 }).notNull().default("INR"),
  status:              varchar("status", { length: 24 }).notNull().default("active"),
  renewalCount:        integer("renewal_count").notNull().default(0),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export const estabLeasePayments = citizenLeaseSchema.table("estab_lease_payments", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  leaseId:       uuid("lease_id").notNull(),
  paymentMonth:  varchar("payment_month", { length: 7 }).notNull(),
  amountMinor:   bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  dueDate:       date("due_date").notNull(),
  paidAt:        timestamp("paid_at", { withTimezone: true }),
  paymentRef:    text("payment_ref"),
  status:        varchar("status", { length: 16 }).notNull().default("pending"),
  lateFeeMinor:  bigint("late_fee_minor", { mode: "bigint" }).notNull().default(0n),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const estabLeaseRequests = citizenLeaseSchema.table("estab_lease_requests", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull(),
  leaseId:               uuid("lease_id").notNull(),
  requestType:           varchar("request_type", { length: 16 }).notNull(),
  requestNumber:         text("request_number").notNull(),
  requestedBy:           uuid("requested_by").notNull(),
  requestedAt:           timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  status:                varchar("status", { length: 24 }).notNull().default("submitted"),
  transfereeName:        text("transferee_name"),
  transfereePhone:       varchar("transferee_phone", { length: 15 }),
  transfereeAadhaar:     varchar("transferee_aadhaar", { length: 12 }),
  surrenderDate:         date("surrender_date"),
  noDuesCertificateRef:  text("no_dues_certificate_ref"),
  approvedBy:            uuid("approved_by"),
  approvedAt:            timestamp("approved_at", { withTimezone: true }),
  remarks:               text("remarks"),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by").notNull(),
  updatedBy:             uuid("updated_by").notNull(),
  version:               integer("version").notNull().default(1),
});

export type LeasePropertyRow      = typeof estabLeaseProperties.$inferSelect;
export type LeasePropertyInsert   = typeof estabLeaseProperties.$inferInsert;
export type LeaseRow              = typeof estabLeases.$inferSelect;
export type LeaseInsert           = typeof estabLeases.$inferInsert;
export type LeasePaymentRow       = typeof estabLeasePayments.$inferSelect;
export type LeasePaymentInsert    = typeof estabLeasePayments.$inferInsert;
export type LeaseRequestRow       = typeof estabLeaseRequests.$inferSelect;
export type LeaseRequestInsert    = typeof estabLeaseRequests.$inferInsert;

export const schema = { estabLeaseProperties, estabLeases, estabLeasePayments, estabLeaseRequests };
