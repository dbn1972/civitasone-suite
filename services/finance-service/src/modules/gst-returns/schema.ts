/**
 * MSME commercial M4 (migration 0184): drizzle mirror of the two NEW tenant tables in the gl schema. Both RLS-scoped (FORCE).
 * gst_return_runs is an immutable, append-only prepared snapshot (trigger); billing's platform-SaaS gstn/ tables are untouched.
 * There is no db/schema.sql or Alembic in finance-service: migrations + this file are the source of truth.
 */
import { uuid, varchar, date, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { glSchema } from "../gl/schema.js";

export const gstReturnSettings = glSchema.table("gst_return_settings", {
  tenantId:        uuid("tenant_id").primaryKey(),
  filingFrequency: varchar("filing_frequency", { length: 10 }).$type<"monthly" | "quarterly">().notNull().default("monthly"),
  updatedBy:       uuid("updated_by").notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:         integer("version").notNull().default(1),
});

export const gstReturnRuns = glSchema.table("gst_return_runs", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  kind:           varchar("kind", { length: 10 }).$type<"periodic" | "iff">().notNull(),
  frequency:      varchar("frequency", { length: 10 }).$type<"monthly" | "quarterly">().notNull(),
  periodKey:      varchar("period_key", { length: 7 }).notNull(),
  fromDate:       date("from_date").notNull(),
  toDate:         date("to_date").notNull(),
  runNo:          integer("run_no").notNull(),
  schemaVersion:  varchar("schema_version", { length: 24 }).notNull(),
  gstin:          varchar("gstin", { length: 15 }).notNull(),
  gstr1Json:      jsonb("gstr1_json").$type<Record<string, unknown>>().notNull(),
  gstr3bJson:     jsonb("gstr3b_json").$type<Record<string, unknown> | null>(),
  summary:        jsonb("summary").$type<Record<string, unknown>>().notNull(),
  reconciliation: jsonb("reconciliation").$type<Record<string, unknown>>().notNull(),
  warnings:       jsonb("warnings").$type<string[]>().notNull().default([]),
  createdBy:      uuid("created_by").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { gstReturnSettings, gstReturnRuns };
