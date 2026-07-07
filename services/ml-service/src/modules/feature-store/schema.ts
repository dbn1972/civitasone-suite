/**
 * feature-store module — Drizzle schema for materialized feature vectors.
 * Stores precomputed feature vectors per entity, cached in Redis with 5-min TTL
 * and persisted in PostgreSQL as the durable source of truth.
 *
 * Validates: Requirements 1.1, 17.4
 */
import { pgSchema, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

export const mlSchema = pgSchema("ml");

export const mlFeatureVectors = mlSchema.table("ml_feature_vectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  domain: text("domain").notNull(),
  entityId: uuid("entity_id").notNull(),
  features: jsonb("features").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantDomainEntity: uniqueIndex("ml_feature_vectors_tenant_domain_entity_idx").on(t.tenantId, t.domain, t.entityId),
  lookup: index("idx_ml_feature_vectors_lookup").on(t.tenantId, t.domain, t.entityId),
}));

export type MlFeatureVectorRow = typeof mlFeatureVectors.$inferSelect;
export type MlFeatureVectorInsert = typeof mlFeatureVectors.$inferInsert;

export type FeatureDomain = "leads" | "tickets" | "inventory" | "subscriptions" | "tasks" | "transactions";

export const schema = { mlFeatureVectors };
