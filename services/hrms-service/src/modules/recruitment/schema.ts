import {
  pgSchema, uuid, text, integer, bigint, char, varchar, date, timestamp,
} from "drizzle-orm/pg-core";

export const recruitmentSchema = pgSchema("recruitment");

export const hrmsJobOpenings = recruitmentSchema.table("hrms_job_openings", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  refNo:         text("ref_no").notNull(),
  title:         text("title").notNull(),
  departmentId:  uuid("department_id").notNull(),
  designationId: uuid("designation_id"),
  vacancies:     integer("vacancies").notNull().default(1),
  description:   text("description"),
  status:        varchar("status", { length: 24 }).notNull().default("open"),
  postedAt:      date("posted_at"),
  closesAt:      date("closes_at"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const hrmsApplications = recruitmentSchema.table("hrms_applications", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  jobOpeningId:  uuid("job_opening_id").notNull(),
  applicantName: text("applicant_name").notNull(),
  email:         text("email"),
  mobile:        varchar("mobile", { length: 20 }),
  resumeRef:     text("resume_ref"),
  stage:         varchar("stage", { length: 32 }).notNull().default("applied"),
  status:        varchar("status", { length: 24 }).notNull().default("active"),
  appliedAt:     timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const hrmsOffers = recruitmentSchema.table("hrms_offers", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  ctcMinor:      bigint("ctc_minor", { mode: "bigint" }).notNull().default(0n),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  joiningDate:   date("joining_date"),
  status:        varchar("status", { length: 24 }).notNull().default("draft"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type JobOpeningRow = typeof hrmsJobOpenings.$inferSelect;
export type ApplicationRow = typeof hrmsApplications.$inferSelect;

export const schema = { hrmsJobOpenings, hrmsApplications, hrmsOffers };
