import {
  pgSchema, uuid, text, varchar, integer, timestamp, date, jsonb,
} from "drizzle-orm/pg-core";

// Real backing stores for the citizen engagement screens
// (/citizen/alerts, /citizen/notices, /citizen/surveys). Migration 0041.
export const engagementSchema = pgSchema("engagement");

export const citizenAlerts = engagementSchema.table("citizen_alerts", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  title:          varchar("title", { length: 200 }).notNull(),
  body:           text("body").notNull().default(""),
  category:       varchar("category", { length: 64 }).notNull().default("general"),
  targetAudience: varchar("target_audience", { length: 128 }).notNull().default("All Citizens"),
  status:         varchar("status", { length: 16 }).notNull().default("draft"),
  publishedAt:    timestamp("published_at", { withTimezone: true }),
  expiresAt:      timestamp("expires_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const citizenNotices = engagementSchema.table("citizen_notices", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  noticeNo:    varchar("notice_no", { length: 64 }).notNull(),
  subject:     varchar("subject", { length: 300 }).notNull(),
  body:        text("body").notNull().default(""),
  department:  varchar("department", { length: 128 }).notNull(),
  noticeType:  varchar("notice_type", { length: 24 }).notNull().default("general"),
  status:      varchar("status", { length: 16 }).notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  expiresAt:   timestamp("expires_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type SurveyQuestion = {
  id: string;
  text: string;
  type: "text" | "single_choice" | "multi_choice" | "rating";
  options?: string[];
  required?: boolean;
};

export const citizenSurveys = engagementSchema.table("citizen_surveys", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  surveyName:      varchar("survey_name", { length: 200 }).notNull(),
  description:     text("description").notNull().default(""),
  questions:       jsonb("questions").$type<SurveyQuestion[]>().notNull().default([]),
  targetResponses: integer("target_responses"),
  startsOn:        date("starts_on", { mode: "string" }),
  endsOn:          date("ends_on", { mode: "string" }),
  status:          varchar("status", { length: 16 }).notNull().default("draft"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type SurveyAnswerValue = string | number | string[];

export const citizenSurveyResponses = engagementSchema.table("citizen_survey_responses", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  surveyId:    uuid("survey_id").notNull(),
  citizenId:   uuid("citizen_id").notNull(),
  answers:     jsonb("answers").$type<Record<string, SurveyAnswerValue>>().notNull().default({}),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});

export type CitizenAlertRow = typeof citizenAlerts.$inferSelect;
export type CitizenAlertInsert = typeof citizenAlerts.$inferInsert;
export type CitizenNoticeRow = typeof citizenNotices.$inferSelect;
export type CitizenNoticeInsert = typeof citizenNotices.$inferInsert;
export type CitizenSurveyRow = typeof citizenSurveys.$inferSelect;
export type CitizenSurveyInsert = typeof citizenSurveys.$inferInsert;
export type CitizenSurveyResponseRow = typeof citizenSurveyResponses.$inferSelect;
export type CitizenSurveyResponseInsert = typeof citizenSurveyResponses.$inferInsert;

export const schema = { citizenAlerts, citizenNotices, citizenSurveys, citizenSurveyResponses };
