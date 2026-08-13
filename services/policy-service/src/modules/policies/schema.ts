import { pgSchema, uuid, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const policiesSchema = pgSchema("policies");

export const policies = policiesSchema.table("policies", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  title:         varchar("title", { length: 512 }).notNull(),
  slug:          varchar("slug", { length: 256 }).notNull(),
  category:      varchar("category", { length: 128 }).notNull().default("general"),
  tags:          text("tags").array().notNull().default([]),
  content:       text("content").notNull().default(""),
  status:        varchar("status", { length: 32 }).notNull().default("draft"),
  ownerId:       uuid("owner_id"),
  publishedAt:   timestamp("published_at", { withTimezone: true }),
  archivedAt:    timestamp("archived_at", { withTimezone: true }),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveTo:   timestamp("effective_to", { withTimezone: true }),
  version:       integer("version").notNull().default(1),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
});

export const policyVersions = policiesSchema.table("policy_versions", {
  id:         uuid("id").primaryKey().defaultRandom(),
  policyId:   uuid("policy_id").notNull(),
  tenantId:   uuid("tenant_id").notNull(),
  versionNum: integer("version_num").notNull(),
  content:    text("content").notNull().default(""),
  status:     varchar("status", { length: 32 }).notNull().default("draft"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
});

export const policyAcknowledgments = policiesSchema.table("policy_acknowledgments", {
  id:        uuid("id").primaryKey().defaultRandom(),
  policyId:  uuid("policy_id").notNull(),
  tenantId:  uuid("tenant_id").notNull(),
  userId:    uuid("user_id").notNull(),
  ackedAt:   timestamp("acked_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: varchar("ip_address", { length: 64 }),
});

export type PolicyRow = typeof policies.$inferSelect;
export type PolicyVersionRow = typeof policyVersions.$inferSelect;
export type AckRow = typeof policyAcknowledgments.$inferSelect;

export const policiesModuleSchema = { policies, policyVersions, policyAcknowledgments };
