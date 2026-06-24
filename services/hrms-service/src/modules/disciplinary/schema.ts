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

export const schema = { hrmsDisciplinaryCases, hrmsDisciplinaryEvents, hrmsSuspensions };
