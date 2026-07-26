import { pgSchema, uuid, varchar, text, integer, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";

const adminSchema = pgSchema("admin");

export const secIncidents = adminSchema.table("sec_incidents", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  title:            varchar("title", { length: 256 }).notNull(),
  severity:         varchar("severity", { length: 16 }).notNull(),
  category:         varchar("category", { length: 48 }).notNull().default("other"),
  status:           varchar("status", { length: 16 }).notNull().default("detected"),
  description:      text("description"),
  affectedAssets:   jsonb("affected_assets").$type<string[]>().notNull().default([]),
  affectedTenants:  jsonb("affected_tenants").$type<string[]>().notNull().default([]),
  isBreach:         boolean("is_breach").notNull().default(false),
  affectedDataPrincipals: integer("affected_data_principals").notNull().default(0),
  rootCause:        text("root_cause"),
  resolution:       text("resolution"),
  detectedAt:       timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  triagedAt:        timestamp("triaged_at", { withTimezone: true }),
  containedAt:      timestamp("contained_at", { withTimezone: true }),
  resolvedAt:       timestamp("resolved_at", { withTimezone: true }),
  closedAt:         timestamp("closed_at", { withTimezone: true }),
  reportedBy:       uuid("reported_by").notNull(),
  closedBy:         uuid("closed_by"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:          integer("version").notNull().default(1),
});

export const secIncidentTimeline = adminSchema.table("sec_incident_timeline", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  incidentId:  uuid("incident_id").notNull(),
  at:          timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorId:     uuid("actor_id").notNull(),
  fromStatus:  varchar("from_status", { length: 16 }),
  toStatus:    varchar("to_status", { length: 16 }),
  note:        text("note"),
});

export const secBreachNotifications = adminSchema.table("sec_breach_notifications", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  incidentId:     uuid("incident_id").notNull(),
  authority:      varchar("authority", { length: 24 }).notNull(),
  status:         varchar("status", { length: 16 }).notNull().default("pending"),
  windowHours:    integer("window_hours").notNull().default(72),
  deadlineAt:     timestamp("deadline_at", { withTimezone: true }).notNull(),
  affectedCount:  integer("affected_count").notNull().default(0),
  reference:      varchar("reference", { length: 128 }),
  submittedAt:    timestamp("submitted_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
});

export const securityIncidentSchema = { secIncidents, secIncidentTimeline, secBreachNotifications };
