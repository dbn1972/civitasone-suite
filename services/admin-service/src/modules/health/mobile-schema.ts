/**
 * CR-MOB-01 — mobile app performance monitoring. Drizzle schema.
 *
 * Extends the existing `health` module (same Postgres schema `health` that holds
 * admin_health_snapshots): server-side health snapshots and client-side mobile
 * telemetry are the same concern viewed from the two ends of a request.
 *
 * These rows arrive from UNTRUSTED mobile clients. Every numeric column is
 * bounded by a CHECK constraint in migration 0027 as well as by zod at the route
 * boundary, so an absurd value cannot be persisted through any code path.
 * No PII: app version, platform, OS version, device model and timings only —
 * never a user identifier beyond the tenant and the authenticated actor.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { healthSchema } from "./schema.js";

export const mobilePgSchema: ReturnType<typeof pgSchema> = healthSchema;

export const mobileTelemetryEvents = healthSchema.table("mobile_telemetry_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  appVersion: varchar("app_version", { length: 32 }).notNull(),
  /** ios | android */
  platform: varchar("platform", { length: 16 }).notNull(),
  osVersion: varchar("os_version", { length: 32 }).notNull().default(""),
  deviceModel: varchar("device_model", { length: 64 }).notNull().default(""),
  coldStartMs: integer("cold_start_ms").notNull(),
  warmStartMs: integer("warm_start_ms"),
  crashCount: integer("crash_count").notNull().default(0),
  anrCount: integer("anr_count").notNull().default(0),
  sessionCount: integer("session_count").notNull().default(1),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const mobileScreenRenders = healthSchema.table("mobile_screen_renders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  eventId: uuid("event_id").notNull(),
  platform: varchar("platform", { length: 16 }).notNull(),
  appVersion: varchar("app_version", { length: 32 }).notNull(),
  screen: varchar("screen", { length: 64 }).notNull(),
  renderMs: integer("render_ms").notNull(),
  sampleCount: integer("sample_count").notNull().default(1),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type MobileTelemetryRow = typeof mobileTelemetryEvents.$inferSelect;
export type MobileTelemetryInsert = typeof mobileTelemetryEvents.$inferInsert;
export type MobileScreenRenderRow = typeof mobileScreenRenders.$inferSelect;
export type MobileScreenRenderInsert = typeof mobileScreenRenders.$inferInsert;

export const mobileSchema = { mobileTelemetryEvents, mobileScreenRenders };
