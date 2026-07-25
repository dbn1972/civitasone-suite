import { pgSchema, uuid, varchar, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
const adminSchema = pgSchema("admin");

export const vaptScans = adminSchema.table("vapt_scans", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  targetServices:  jsonb("target_services").notNull(),
  scanType:        varchar("scan_type", { length: 16 }).notNull(),
  status:          varchar("status", { length: 16 }).notNull().default("queued"),
  findingsCount:   integer("findings_count").notNull().default(0),
  critical:        integer("critical").notNull().default(0),
  high:            integer("high").notNull().default(0),
  medium:          integer("medium").notNull().default(0),
  low:             integer("low").notNull().default(0),
  startedAt:       timestamp("started_at", { withTimezone: true }),
  completedAt:     timestamp("completed_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
});

export const securityIncidents = adminSchema.table("security_incidents", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  title:        varchar("title", { length: 256 }).notNull(),
  severity:     varchar("severity", { length: 16 }).notNull(),
  status:       varchar("status", { length: 24 }).notNull().default("open"),
  description:  text("description"),
  affectedServices: jsonb("affected_services").notNull().default([]),
  detectedAt:   timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt:   timestamp("resolved_at", { withTimezone: true }),
  reportedToCert: timestamp("reported_to_cert", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
});

export const securityComplianceSchema = { vaptScans, securityIncidents };
