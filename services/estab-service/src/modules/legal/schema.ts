import {
  pgSchema, uuid, text, varchar, integer, timestamp, date,
} from "drizzle-orm/pg-core";

export const legalSchema = pgSchema("legal");

export const estabCourtCases = legalSchema.table("estab_court_cases", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  caseNo:      text("case_no").notNull(),
  title:       text("title").notNull(),
  court:       text("court").notNull(),
  subject:     text("subject"),
  petitioner:  text("petitioner"),
  counselRef:  text("counsel_ref"),
  nextHearing: date("next_hearing"),
  status:      varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const estabCaseDates = legalSchema.table("estab_case_dates", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  caseId:      uuid("case_id").notNull(),
  hearingDate: date("hearing_date").notNull(),
  purpose:     text("purpose"),
  outcome:     text("outcome"),
  nextDate:    date("next_date"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const estabRtiRequests = legalSchema.table("estab_rti_requests", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  rtiNo:       text("rti_no").notNull(),
  applicant:   text("applicant").notNull(),
  subject:     text("subject").notNull(),
  cpioRef:     uuid("cpio_ref").notNull(),
  deadline:    date("deadline").notNull(),
  responseUrl: text("response_url"),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  status:      varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type CourtCaseRow    = typeof estabCourtCases.$inferSelect;
export type CourtCaseInsert = typeof estabCourtCases.$inferInsert;
export type CaseDateInsert  = typeof estabCaseDates.$inferInsert;
export type RtiRow          = typeof estabRtiRequests.$inferSelect;
export type RtiInsert       = typeof estabRtiRequests.$inferInsert;

export const schema = { estabCourtCases, estabCaseDates, estabRtiRequests };
