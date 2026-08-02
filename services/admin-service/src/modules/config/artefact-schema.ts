/**
 * WC-010 — configuration as a versioned artefact. Drizzle schema.
 *
 * Extends the existing `config` module (same Postgres schema `config`, same L2
 * boundary): the feature-flag / module-config rows in this schema are the
 * *live* config, these three tables make a config SET promotable like a build
 * artefact.
 *
 *   config_artefacts  → immutable snapshot of a config set at a point in time.
 *                       `artefactVersion` is the monotonic artefact number per
 *                       (tenant, setKey); the standard `version` column is the
 *                       row's optimistic-lock counter and never moves, because
 *                       an artefact is immutable by construction.
 *   config_promotions → maker-checker record of promoting an artefact version
 *                       into an environment (or rolling one back).
 *   config_env_state  → which artefact version is live in each environment.
 *                       MUTABLE, so `version` is a real optimistic lock: every
 *                       UPDATE carries `WHERE version = $current` and a mismatch
 *                       surfaces as 409 VERSION_CONFLICT.
 */
import { pgSchema, uuid, varchar, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { configSchema } from "./schema.js";

/** Re-exported so this file reads standalone; identical to config/schema.ts. */
export const artefactPgSchema: ReturnType<typeof pgSchema> = configSchema;

export const configArtefacts = configSchema.table("config_artefacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  setKey: varchar("set_key", { length: 160 }).notNull(),
  artefactVersion: integer("artefact_version").notNull(),
  entries: jsonb("entries").$type<Record<string, unknown>>().notNull().default({}),
  checksum: varchar("checksum", { length: 64 }).notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  setVersionUnique: uniqueIndex("uq_config_artefacts_set_version").on(t.tenantId, t.setKey, t.artefactVersion),
}));

export const configPromotions = configSchema.table("config_promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  setKey: varchar("set_key", { length: 160 }).notNull(),
  artefactId: uuid("artefact_id").notNull(),
  artefactVersion: integer("artefact_version").notNull(),
  targetEnv: varchar("target_env", { length: 32 }).notNull(),
  /** promote | rollback */
  kind: varchar("kind", { length: 16 }).notNull().default("promote"),
  /** pending | promoted | rejected */
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  requestedBy: uuid("requested_by").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const configEnvState = configSchema.table("config_env_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  setKey: varchar("set_key", { length: 160 }).notNull(),
  environment: varchar("environment", { length: 32 }).notNull(),
  artefactId: uuid("artefact_id").notNull(),
  artefactVersion: integer("artefact_version").notNull(),
  promotedBy: uuid("promoted_by").notNull(),
  promotedAt: timestamp("promoted_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  setEnvUnique: uniqueIndex("uq_config_env_state_set_env").on(t.tenantId, t.setKey, t.environment),
}));

export type ConfigArtefactRow = typeof configArtefacts.$inferSelect;
export type ConfigArtefactInsert = typeof configArtefacts.$inferInsert;
export type ConfigPromotionRow = typeof configPromotions.$inferSelect;
export type ConfigPromotionInsert = typeof configPromotions.$inferInsert;
export type ConfigEnvStateRow = typeof configEnvState.$inferSelect;
export type ConfigEnvStateInsert = typeof configEnvState.$inferInsert;

export const artefactSchema = { configArtefacts, configPromotions, configEnvState };
