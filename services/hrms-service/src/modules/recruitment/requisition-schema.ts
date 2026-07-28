import {
  pgSchema, uuid, varchar, integer, bigint, boolean, date, text, jsonb, timestamp,
} from "drizzle-orm/pg-core";

const recruitmentSchema = pgSchema("recruitment");

/** First-class recruitment requisition (checklist "Job requisition"). */
export const hrmsRequisitions = recruitmentSchema.table("hrms_requisitions", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  requisitionNo:       varchar("requisition_no", { length: 48 }).notNull(),
  title:               varchar("title", { length: 200 }).notNull(),
  positionId:          uuid("position_id"),
  sourceManpowerReqId: uuid("source_manpower_req_id"),
  reason:              text("reason"),
  employmentType:      varchar("employment_type", { length: 24 }).notNull().default("permanent"),
  recruitmentMode:     varchar("recruitment_mode", { length: 24 }).notNull().default("direct"),
  campaignType:        varchar("campaign_type", { length: 24 }).notNull().default("direct"),
  departmentId:        uuid("department_id"),
  designationId:       uuid("designation_id"),
  grade:               varchar("grade", { length: 48 }),
  location:            varchar("location", { length: 200 }),
  vacancies:           integer("vacancies").notNull().default(1),
  experienceMinYears:  integer("experience_min_years").notNull().default(0),
  qualification:       varchar("qualification", { length: 1000 }),
  skills:              text("skills"),
  reservation:         jsonb("reservation").notNull().default({}),
  budgetMinor:         bigint("budget_minor", { mode: "bigint" }),
  confidential:        boolean("confidential").notNull().default(false),
  agencyId:            uuid("agency_id"),
  targetHireDate:      date("target_hire_date"),
  slaDays:             integer("sla_days"),
  approvalChain:       jsonb("approval_chain").notNull().default([]),
  currentStage:        integer("current_stage").notNull().default(-1),
  status:              varchar("status", { length: 20 }).notNull().default("draft"),
  holdReason:          text("hold_reason"),
  closeReason:         text("close_reason"),
  publishedOpeningId:  uuid("published_opening_id"),
  submittedAt:         timestamp("submitted_at", { withTimezone: true }),
  approvedAt:          timestamp("approved_at", { withTimezone: true }),
  publishedAt:         timestamp("published_at", { withTimezone: true }),
  version:             integer("version").notNull().default(1),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
});

/** Immutable approval-chain audit trail. */
export const hrmsRequisitionApprovals = recruitmentSchema.table("hrms_requisition_approvals", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  requisitionId: uuid("requisition_id").notNull(),
  stage:         integer("stage").notNull(),
  stageRole:     varchar("stage_role", { length: 48 }).notNull(),
  action:        varchar("action", { length: 12 }).notNull(),
  comments:      text("comments"),
  actorId:       uuid("actor_id").notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RequisitionRow = typeof hrmsRequisitions.$inferSelect;
export type RequisitionInsert = typeof hrmsRequisitions.$inferInsert;
export type RequisitionApprovalRow = typeof hrmsRequisitionApprovals.$inferSelect;

export const schema = { hrmsRequisitions, hrmsRequisitionApprovals };
