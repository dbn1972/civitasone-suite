/**
 * reports module schema — inspection reports and observations.
 * PG Schema: `reports`
 */
import {
  pgSchema, uuid, text, varchar, integer, timestamp,
} from "drizzle-orm/pg-core";

export const reportsSchema = pgSchema("reports");

export const inspectionReports = reportsSchema.table("inspection_reports", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  inspectionId:    uuid("inspection_id").notNull(),
  entityId:        uuid("entity_id").notNull(),
  inspectorId:     uuid("inspector_id").notNull(),
  reportType:      varchar("report_type", { length: 32 }).notNull().default("standard"),
  status:          varchar("status", { length: 24 }).notNull().default("draft"),
  summary:         text("summary"),
  recommendations: text("recommendations"),
  overallGrade:    varchar("overall_grade", { length: 8 }),
  submittedAt:     timestamp("submitted_at", { withTimezone: true }),
  approvedAt:      timestamp("approved_at", { withTimezone: true }),
  approvedBy:      uuid("approved_by"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const observations = reportsSchema.table("observations", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  reportId:    uuid("report_id").notNull(),
  category:    varchar("category", { length: 64 }).notNull(),
  severity:    varchar("severity", { length: 16 }).notNull().default("minor"),
  description: text("description").notNull(),
  location:    text("location"),
  status:      varchar("status", { length: 24 }).notNull().default("open"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});

export type InspectionReportRow    = typeof inspectionReports.$inferSelect;
export type InspectionReportInsert = typeof inspectionReports.$inferInsert;
export type ObservationRow         = typeof observations.$inferSelect;
