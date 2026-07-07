import { pgSchema, uuid, text, integer, varchar, timestamp } from "drizzle-orm/pg-core";

export const versionsSchema = pgSchema("versions");

export const contractVersions = versionsSchema.table("contract_versions", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  contractId:    uuid("contract_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  content:       text("content").notNull(),
  createdBy:     uuid("created_by").notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const redlines = versionsSchema.table("redlines", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  contractId:    uuid("contract_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  position:      integer("position").notNull(),
  type:          varchar("type", { length: 10 }).notNull(), // "insert" | "delete"
  content:       text("content").notNull(),
  actor:         uuid("actor").notNull(),
  timestamp:     timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export type ContractVersionRow = typeof contractVersions.$inferSelect;
export type ContractVersionInsert = typeof contractVersions.$inferInsert;
export type RedlineRow = typeof redlines.$inferSelect;
export type RedlineInsert = typeof redlines.$inferInsert;

export const schema = { contractVersions, redlines };
