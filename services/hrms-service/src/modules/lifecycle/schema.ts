import {
  pgSchema, uuid, text, integer, bigint, boolean, char, varchar, date, timestamp,
} from "drizzle-orm/pg-core";

export const lifecycleSchema = pgSchema("lifecycle");

export const hrmsTransfers = lifecycleSchema.table("hrms_transfers", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  employeeId:   uuid("employee_id").notNull(),
  fromDeptId:   uuid("from_dept_id").notNull(),
  toDeptId:     uuid("to_dept_id").notNull(),
  fromDesigId:  uuid("from_desig_id"),
  toDesigId:    uuid("to_desig_id"),
  effectiveDate: date("effective_date").notNull(),
  orderRef:     text("order_ref"),
  fromStation:  varchar("from_station", { length: 128 }),
  toStation:    varchar("to_station", { length: 128 }),
  orderNo:      varchar("order_no", { length: 64 }),
  orderDate:    date("order_date"),
  relievedDate: date("relieved_date"),
  joinedDate:   date("joined_date"),
  status:       varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type TransferRow = typeof hrmsTransfers.$inferSelect;

export const hrmsPromotions = lifecycleSchema.table("hrms_promotions", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  fromDesigId:   uuid("from_desig_id").notNull(),
  toDesigId:     uuid("to_desig_id").notNull(),
  effectiveDate: date("effective_date").notNull(),
  orderRef:      text("order_ref"),
  newBasicMinor: bigint("new_basic_minor", { mode: "bigint" }),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  status:        varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type PromotionRow = typeof hrmsPromotions.$inferSelect;

export const hrmsSeparations = lifecycleSchema.table("hrms_separations", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  employeeId:       uuid("employee_id").notNull(),
  separationType:   varchar("separation_type", { length: 32 }).notNull(),
  effectiveDate:    date("effective_date").notNull(),
  lastWorkingDate:  date("last_working_date"),
  encashmentDays:   integer("encashment_days").notNull().default(0),
  encashmentMinor:  bigint("encashment_minor", { mode: "bigint" }).notNull().default(0n),
  gratuityMinor:    bigint("gratuity_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  remarks:          text("remarks"),
  status:           varchar("status", { length: 24 }).notNull().default("initiated"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export type SeparationRow = typeof hrmsSeparations.$inferSelect;

// ── Sprint 3: Onboarding + Structured Data ─────────────────────────────────

// T18 (HTR-PO-0173): BGV component tracking.
export const hrmsBgvChecks = lifecycleSchema.table("hrms_bgv_checks", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  checkType:     varchar("check_type", { length: 32 }).notNull(),
  provider:      varchar("provider", { length: 64 }),
  status:        varchar("status", { length: 16 }).notNull().default("pending"),
  result:        text("result"),
  initiatedAt:   timestamp("initiated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:   timestamp("completed_at", { withTimezone: true }),
  createdBy:     uuid("created_by").notNull(),
  version:       integer("version").notNull().default(1),
});

// T19 (HTR-PO-0192): 30/60/90-day onboarding task tracking.
export const hrmsOnboardingTasks = lifecycleSchema.table("hrms_onboarding_tasks", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  title:         varchar("title", { length: 200 }).notNull(),
  dueByDay:      integer("due_by_day").notNull(),
  status:        varchar("status", { length: 16 }).notNull().default("pending"),
  completedAt:   timestamp("completed_at", { withTimezone: true }),
  assignedTo:    uuid("assigned_to"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  version:       integer("version").notNull().default(1),
});

// T20 (HTR-PO-0191): buddy/mentor assignment.
export const hrmsBuddyAssignments = lifecycleSchema.table("hrms_buddy_assignments", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  buddyId:       uuid("buddy_id").notNull(),
  role:          varchar("role", { length: 16 }).notNull().default("buddy"),
  assignedAt:    timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt:       timestamp("ended_at", { withTimezone: true }),
  createdBy:     uuid("created_by").notNull(),
});

// T21 (HTR-PO-0169): mandatory document configuration per employee type.
export const hrmsMandatoryDocConfigs = lifecycleSchema.table("hrms_mandatory_doc_configs", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeType:  varchar("employee_type", { length: 32 }).notNull(),
  docType:       varchar("doc_type", { length: 64 }).notNull(),
  required:      boolean("required").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

// T22 (CH-EMDS-0222): property-return filing tracking (separation).
export const hrmsPropertyReturns = lifecycleSchema.table("hrms_property_returns", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  itemDescription: text("item_description").notNull(),
  returnStatus:  varchar("return_status", { length: 16 }).notNull().default("pending"),
  returnedAt:    timestamp("returned_at", { withTimezone: true }),
  verifiedBy:    uuid("verified_by"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  version:       integer("version").notNull().default(1),
});

// T23 (R-RA-0084/0085): structured education + employment history (employee-side).
export const hrmsEmployeeEducation = lifecycleSchema.table("hrms_employee_education", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  qualification: varchar("qualification", { length: 120 }).notNull(),
  subject:       varchar("subject", { length: 200 }),
  institution:   varchar("institution", { length: 200 }),
  yearOfPassing: integer("year_of_passing"),
  verified:      boolean("verified").notNull().default(false),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

export const hrmsEmployeeEmploymentHistory = lifecycleSchema.table("hrms_employee_employment_history", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  employer:      varchar("employer", { length: 200 }).notNull(),
  roleTitle:     varchar("role_title", { length: 200 }),
  fromDate:      date("from_date"),
  toDate:        date("to_date"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

// T24 (HTR-PO-0190): policy acknowledgement tracking.
export const hrmsPolicyAcknowledgements = lifecycleSchema.table("hrms_policy_acknowledgements", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  policyName:    varchar("policy_name", { length: 200 }).notNull(),
  policyVersion: varchar("policy_version", { length: 24 }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

// 0314: Employee hold/release with approval status
export const hrmsEmployeeHolds = lifecycleSchema.table("hrms_employee_holds", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  holdType:      varchar("hold_type", { length: 32 }).notNull(),
  reason:        text("reason").notNull(),
  status:        varchar("status", { length: 16 }).notNull().default("pending"),
  requestedBy:   uuid("requested_by").notNull(),
  approvedBy:    uuid("approved_by"),
  approvedAt:    timestamp("approved_at", { withTimezone: true }),
  releasedBy:    uuid("released_by"),
  releasedAt:    timestamp("released_at", { withTimezone: true }),
  releaseReason: text("release_reason"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo:   date("effective_to"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:       integer("version").notNull().default(1),
});
export type EmployeeHoldRow = typeof hrmsEmployeeHolds.$inferSelect;
export type EmployeeHoldInsert = typeof hrmsEmployeeHolds.$inferInsert;

export const schema = { hrmsTransfers, hrmsPromotions, hrmsSeparations, hrmsBgvChecks, hrmsOnboardingTasks, hrmsBuddyAssignments, hrmsMandatoryDocConfigs, hrmsPropertyReturns, hrmsEmployeeEducation, hrmsEmployeeEmploymentHistory, hrmsPolicyAcknowledgements, hrmsEmployeeHolds };
