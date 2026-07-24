import { pgSchema, uuid, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const digestSchema = pgSchema("digest");

export const digestRules = digestSchema.table("digest_rules", {
  id:                        uuid("id").primaryKey().defaultRandom(),
  tenantId:                  uuid("tenant_id").notNull(),
  eventType:                 varchar("event_type", { length: 128 }).notNull(),
  channel:                   varchar("channel", { length: 32 }).notNull(),
  accumulationWindowMinutes: integer("accumulation_window_minutes").notNull(),
  maxBatchSize:              integer("max_batch_size").notNull().default(50),
  digestTemplateId:          uuid("digest_template_id").notNull(),
  enabled:                   boolean("enabled").notNull().default(true),
  createdAt:                 timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                 timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:                 uuid("created_by").notNull(),
  updatedBy:                 uuid("updated_by").notNull(),
  version:                   integer("version").notNull().default(1),
});

export const digestBuckets = digestSchema.table("digest_buckets", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  ruleId:      uuid("rule_id").notNull(),
  recipient:   varchar("recipient", { length: 254 }).notNull(),
  recipientId: uuid("recipient_id"),
  channel:     varchar("channel", { length: 32 }).notNull(),
  items:       jsonb("items").notNull().default([]),
  itemCount:   integer("item_count").notNull().default(0),
  openedAt:    timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  status:      varchar("status", { length: 24 }).notNull().default("accumulating"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type DigestRuleRow = typeof digestRules.$inferSelect;
export type DigestRuleInsert = typeof digestRules.$inferInsert;
export type DigestBucketRow = typeof digestBuckets.$inferSelect;
export type DigestBucketInsert = typeof digestBuckets.$inferInsert;

export const digestModuleSchema = { digestRules, digestBuckets };
