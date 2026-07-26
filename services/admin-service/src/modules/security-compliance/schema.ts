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

// CAP-089 — real control library (replaces hardcoded SOC2 arrays)
export const complianceControls = adminSchema.table("compliance_controls", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  controlKey:   varchar("control_key", { length: 32 }).notNull(),
  framework:    varchar("framework", { length: 16 }).notNull(),
  title:        varchar("title", { length: 256 }).notNull(),
  description:  text("description"),
  owner:        varchar("owner", { length: 128 }),
  status:       varchar("status", { length: 16 }).notNull().default("not_tested"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const controlEvidence = adminSchema.table("control_evidence", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  controlId:   uuid("control_id").notNull(),
  kind:        varchar("kind", { length: 24 }).notNull(),
  reference:   varchar("reference", { length: 512 }),
  note:        text("note"),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});

export const securityComplianceSchema = { vaptScans, securityIncidents, complianceControls, controlEvidence };
