import { pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date, jsonb } from "drizzle-orm/pg-core";

export const contractsSchema = pgSchema("contracts");

export const contractContracts = contractsSchema.table("contract_contracts", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  contractNo:  text("contract_no").notNull(),
  vendorId:    uuid("vendor_id").notNull(),
  poRef:       text("po_ref"),
  title:       text("title").notNull(),
  valueMinor:  bigint("value_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  startDate:   date("start_date").notNull(),
  expiry:      date("expiry").notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("draft"),
  slaTerms:    jsonb("sla_terms"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const contractMilestones = contractsSchema.table("contract_milestones", {
  id:           uuid("id").primaryKey().defaultRandom(),
  contractId:   uuid("contract_id").notNull(),
  tenantId:     uuid("tenant_id").notNull(),
  title:        text("title").notNull(),
  dueDate:      date("due_date").notNull(),
  amountMinor:  bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:     char("currency", { length: 3 }).notNull().default("INR"),
  status:       varchar("status", { length: 24 }).notNull().default("pending"),
  achievedDate: date("achieved_date"),
  penaltyMinor: bigint("penalty_minor", { mode: "bigint" }).notNull().default(0n),
  netPayableMinor: bigint("net_payable_minor", { mode: "bigint" }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const contractAmendments = contractsSchema.table("contract_amendments", {
  id:           uuid("id").primaryKey().defaultRandom(),
  contractId:   uuid("contract_id").notNull(),
  tenantId:     uuid("tenant_id").notNull(),
  amendmentNo:  integer("amendment_no").notNull().default(1),
  reason:       text("reason").notNull(),
  valueDelta:   bigint("value_delta", { mode: "bigint" }).notNull().default(0n),
  newExpiry:    date("new_expiry"),
  approvedBy:   uuid("approved_by"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type ContractRow    = typeof contractContracts.$inferSelect;
export type ContractInsert = typeof contractContracts.$inferInsert;
export type AmendmentRow   = typeof contractAmendments.$inferSelect;

export const contractPerformanceBonds = contractsSchema.table("contract_performance_bonds", {
  id:           uuid("id").primaryKey().defaultRandom(),
  contractId:   uuid("contract_id").notNull(),
  tenantId:     uuid("tenant_id").notNull(),
  bondType:     varchar("bond_type", { length: 32 }).notNull().default("performance"),
  amountMinor:  bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:     char("currency", { length: 3 }).notNull().default("INR"),
  issuer:       text("issuer").notNull(),
  referenceNo:  text("reference_no").notNull(),
  validFrom:    date("valid_from").notNull(),
  validTo:      date("valid_to").notNull(),
  status:       varchar("status", { length: 24 }).notNull().default("held"),
  notes:        text("notes"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type PerformanceBondRow = typeof contractPerformanceBonds.$inferSelect;

export const schema = { contractContracts, contractMilestones, contractAmendments, contractPerformanceBonds };
