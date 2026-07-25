/**
 * feature_flags module — Drizzle schema. Lives in its OWN Postgres schema `feature_flags`.
 * L2 rule: this module's repo queries ONLY `feature_flags.*`.
 */
import { pgSchema, uuid, varchar, text, boolean, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const featureFlagsSchema = pgSchema("feature_flags");

export const featureFlags = featureFlagsSchema.table("feature_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  key: varchar("key", { length: 128 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description").notNull().default(""),
  enabled: boolean("enabled").notNull().default(false),
  rolloutPercent: integer("rollout_percent").notNull().default(0),
  targetSegments: jsonb("target_segments").notNull().$type<string[]>().default([]),
  killSwitch: boolean("kill_switch").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  owner: varchar("owner", { length: 160 }).notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type FeatureFlagRow = typeof featureFlags.$inferSelect;
export type FeatureFlagInsert = typeof featureFlags.$inferInsert;

export const schema = { featureFlags };
