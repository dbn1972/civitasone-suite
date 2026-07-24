import {
  pgSchema, uuid, varchar, date, text, timestamp, integer, jsonb, boolean,
} from "drizzle-orm/pg-core";

export const contractsSchema = pgSchema("contracts");

/**
 * Contract records — tracks the full lifecycle of a contractual employee's
 * agreement (draft → active → expiring → expired/renewed/terminated).
 */
export const hrmsContracts = contractsSchema.table("hrms_contracts", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  employeeId:         uuid("employee_id").notNull(),
  contractNo:         varchar("contract_no", { length: 32 }).notNull(),
  startDate:          date("start_date").notNull(),
  endDate:            date("end_date").notNull(),
  terms:              jsonb("terms").notNull().default({}),
  renewalCount:       integer("renewal_count").notNull().default(0),
  status:             varchar("status", { length: 24 }).notNull().default("draft"),
  previousContractId: uuid("previous_contract_id"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

export type ContractRow = typeof hrmsContracts.$inferSelect;
export type ContractInsert = typeof hrmsContracts.$inferInsert;

/**
 * Renewal records — tracks each renewal attempt through the approval chain.
 */
export const hrmsContractRenewals = contractsSchema.table("hrms_contract_renewals", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  contractId:      uuid("contract_id").notNull(),
  renewalNumber:   integer("renewal_number").notNull(),
  initiatedBy:     uuid("initiated_by").notNull(),
  initiatedAt:     timestamp("initiated_at", { withTimezone: true }).notNull().defaultNow(),
  status:          varchar("status", { length: 32 }).notNull().default("pending_approval"),
  newEndDate:      date("new_end_date").notNull(),
  originalTerms:   jsonb("original_terms").notNull(),
  newTerms:        jsonb("new_terms").notNull(),
  approvalChain:   jsonb("approval_chain").notNull().default([]),
  approvedBy:      uuid("approved_by"),
  approvedAt:      timestamp("approved_at", { withTimezone: true }),
  rejectedBy:      uuid("rejected_by"),
  rejectedAt:      timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  budgetRef:       varchar("budget_ref", { length: 64 }),
  newContractId:   uuid("new_contract_id"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type RenewalRow = typeof hrmsContractRenewals.$inferSelect;
export type RenewalInsert = typeof hrmsContractRenewals.$inferInsert;

/**
 * Notification deduplication — ensures each milestone is sent only once per contract.
 */
export const hrmsContractNotifications = contractsSchema.table("hrms_contract_notifications", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  contractId: uuid("contract_id").notNull(),
  milestone:  integer("milestone").notNull(),
  sentAt:     timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationRow = typeof hrmsContractNotifications.$inferSelect;
export type NotificationInsert = typeof hrmsContractNotifications.$inferInsert;

/**
 * Tenant-level contract configuration (reminder milestones, approval chain,
 * auto-separation toggle, scheduler time).
 */
export const hrmsContractConfig = contractsSchema.table("hrms_contract_config", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull().unique(),
  reminderMilestones:    jsonb("reminder_milestones").notNull().default([90, 60, 30, 15, 7]),
  approvalChain:         jsonb("approval_chain").notNull().default([]),
  autoSeparationEnabled: boolean("auto_separation_enabled").notNull().default(true),
  schedulerTimeUtc:      varchar("scheduler_time_utc", { length: 5 }).notNull().default("02:00"),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:               integer("version").notNull().default(1),
});

export type ConfigRow = typeof hrmsContractConfig.$inferSelect;
export type ConfigInsert = typeof hrmsContractConfig.$inferInsert;

/**
 * Per-tenant sequence counter for generating sequential contract numbers.
 */
export const hrmsContractSeq = contractsSchema.table("hrms_contract_seq", {
  tenantId: uuid("tenant_id").primaryKey(),
  nextVal:  integer("next_val").notNull().default(1),
});

export type SeqRow = typeof hrmsContractSeq.$inferSelect;
export type SeqInsert = typeof hrmsContractSeq.$inferInsert;

export const schema = {
  hrmsContracts,
  hrmsContractRenewals,
  hrmsContractNotifications,
  hrmsContractConfig,
  hrmsContractSeq,
};
