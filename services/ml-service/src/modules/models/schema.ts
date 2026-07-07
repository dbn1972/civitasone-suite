/**
 * models module — Drizzle schema for the ML model registry.
 * Stores model metadata, version history, evaluation metrics, and model cards.
 * All tables are tenant-scoped with RLS and optimistic locking via `versionLock`.
 *
 * Validates: Requirements 1.1, 2.1
 */
import { pgSchema, uuid, text, integer, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const mlSchema = pgSchema("ml");

export const mlModels = mlSchema.table("ml_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  domain: text("domain").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull().default("candidate"),
  s3Key: text("s3_key").notNull(),
  trainedAt: timestamp("trained_at", { withTimezone: true }).notNull(),
  recordCount: integer("record_count").notNull(),
  metrics: jsonb("metrics").notNull().default({}),
  featureList: text("feature_list").array().notNull().default(sql`'{}'`),
  modelCard: jsonb("model_card"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  versionLock: integer("version_lock").notNull().default(1),
}, (t) => ({
  tenantDomainVersion: uniqueIndex("ml_models_tenant_domain_version_idx").on(t.tenantId, t.domain, t.version),
  activeLookup: index("idx_ml_models_tenant_domain_active").on(t.tenantId, t.domain).where(sql`status = 'active'`),
}));

export type MlModelRow = typeof mlModels.$inferSelect;
export type MlModelInsert = typeof mlModels.$inferInsert;

export type ModelStatus = "training" | "candidate" | "active" | "deactivated" | "archived";
export type ModelDomain = "leads" | "tickets" | "inventory" | "subscriptions" | "tasks" | "transactions";

export const schema = { mlModels };
