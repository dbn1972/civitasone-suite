import {
  pgSchema, uuid, varchar, text, date, timestamp, integer, boolean, numeric,
} from "drizzle-orm/pg-core";

export const disciplinarySchema = pgSchema("disciplinary");

export const hrmsDisciplinaryCases = disciplinarySchema.table("hrms_disciplinary_cases", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  employeeId:          uuid("employee_id").notNull(),
  caseNo:              varchar("case_no", { length: 48 }).notNull(),
  proceedingType:      varchar("proceeding_type", { length: 16 }).notNull().default("major"),
  status:              varchar("status", { length: 32 }).notNull().default("opened"),
  allegation:          text("allegation").notNull(),
  chargeMemoRef:       text("charge_memo_ref"),
  chargeMemoDate:      date("charge_memo_date"),
  inquiryOfficerId:    uuid("inquiry_officer_id"),
  inquiryOfficerName:  text("inquiry_officer_name"),
  inquiryAppointedDate: date("inquiry_appointed_date"),
  finding:             varchar("finding", { length: 24 }),
  findingNotes:        text("finding_notes"),
  findingDate:         date("finding_date"),
  penaltyClass:        varchar("penalty_class", { length: 16 }),
  penaltyType:         varchar("penalty_type", { length: 48 }),
  penaltyDetail:       text("penalty_detail"),
  penaltyDate:         date("penalty_date"),
  appealFiledDate:     date("appeal_filed_date"),
  appealAuthority:     text("appeal_authority"),
  appealOutcome:       varchar("appeal_outcome", { length: 24 }),
  appealDecidedDate:   date("appeal_decided_date"),
  closedAt:            timestamp("closed_at", { withTimezone: true }),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export const hrmsDisciplinaryEvents = disciplinarySchema.table("hrms_disciplinary_events", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  caseId:     uuid("case_id").notNull(),
  fromStatus: varchar("from_status", { length: 32 }),
  toStatus:   varchar("to_status", { length: 32 }).notNull(),
  action:     varchar("action", { length: 48 }).notNull(),
  notes:      text("notes"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  actorId:    uuid("actor_id").notNull(),
});

export const hrmsSuspensions = disciplinarySchema.table("hrms_suspensions", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  employeeId:     uuid("employee_id").notNull(),
  caseId:         uuid("case_id"),
  orderRef:       text("order_ref"),
  fromDate:       date("from_date").notNull(),
  toDate:         date("to_date"),
  paySuspended:   boolean("pay_suspended").notNull().default(true),
  subsistencePct: numeric("subsistence_pct").notNull().default("50.00"),
  status:         varchar("status", { length: 16 }).notNull().default("active"),
  revokedDate:    date("revoked_date"),
  remarks:        text("remarks"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type DisciplinaryCaseRow = typeof hrmsDisciplinaryCases.$inferSelect;
export type DisciplinaryCaseInsert = typeof hrmsDisciplinaryCases.$inferInsert;
export type SuspensionRow = typeof hrmsSuspensions.$inferSelect;
export type SuspensionInsert = typeof hrmsSuspensions.$inferInsert;

// ── Sprint 4: POSH / ICC Case Management (T25–T29) ────────────────────────

// T25 (ER-GPDV-0561..0567): ICC complaint intake (confidential).
export const hrmsIccComplaints = disciplinarySchema.table("hrms_icc_complaints", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  complainantId: uuid("complainant_id").notNull(),
  respondentId:  uuid("respondent_id"),
  summary:       text("summary").notNull(),
  filedAt:       timestamp("filed_at", { withTimezone: true }).notNull().defaultNow(),
  status:        varchar("status", { length: 16 }).notNull().default("filed"),
  confidential:  boolean("confidential").notNull().default(true),
  iccMembersOnly: boolean("icc_members_only").notNull().default(true),
  createdBy:     uuid("created_by").notNull(),
  version:       integer("version").notNull().default(1),
});

// T26 (ER-GPDV-0568..0570): ICC hearing + finding.
export const hrmsIccHearings = disciplinarySchema.table("hrms_icc_hearings", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  complaintId:   uuid("complaint_id").notNull(),
  hearingDate:   date("hearing_date").notNull(),
  notes:         text("notes"),
  finding:       varchar("finding", { length: 24 }),
  conductedBy:   uuid("conducted_by"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version:       integer("version").notNull().default(1),
});

// T27 (ER-GPDV-0571..0573): statutory 90-day timeline tracking.
export const hrmsIccTimelines = disciplinarySchema.table("hrms_icc_timelines", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  complaintId:   uuid("complaint_id").notNull(),
  milestone:     varchar("milestone", { length: 32 }).notNull(),
  dueDate:       date("due_date").notNull(),
  completedAt:   timestamp("completed_at", { withTimezone: true }),
  escalatedAt:   timestamp("escalated_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// T28 (ER-GPDV-0563..0566): access control — complaint restricted to ICC members.
// Covered by hrmsIccComplaints.icc_members_only + RLS policy (HR cannot see without ICC role).

// T29 (ER-GPDV-0579/0583): annual POSH report data (generated from complaints).
export const hrmsIccAnnualReports = disciplinarySchema.table("hrms_icc_annual_reports", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  year:          integer("year").notNull(),
  totalFiled:    integer("total_filed").notNull().default(0),
  totalResolved: integer("total_resolved").notNull().default(0),
  totalPending:  integer("total_pending").notNull().default(0),
  generatedAt:   timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  generatedBy:   uuid("generated_by").notNull(),
});

// 0176: COI / confidentiality declarations (CCS Conduct Rules)
export const hrmsCoiDeclarations = disciplinarySchema.table("hrms_coi_declarations", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  employeeId:      uuid("employee_id").notNull(),
  declarationType: varchar("declaration_type", { length: 32 }).notNull(),
  declarationDate: date("declaration_date").notNull(),
  details:         text("details").notNull(),
  status:          varchar("status", { length: 16 }).notNull().default("active"),
  acknowledgedAt:  timestamp("acknowledged_at", { withTimezone: true }),
  revokedAt:       timestamp("revoked_at", { withTimezone: true }),
  revokeReason:    text("revoke_reason"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type CoiDeclarationRow = typeof hrmsCoiDeclarations.$inferSelect;
export type CoiDeclarationInsert = typeof hrmsCoiDeclarations.$inferInsert;

export const schema = { hrmsDisciplinaryCases, hrmsDisciplinaryEvents, hrmsSuspensions, hrmsIccComplaints, hrmsIccHearings, hrmsIccTimelines, hrmsIccAnnualReports, hrmsCoiDeclarations };
