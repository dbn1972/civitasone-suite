import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

export const definitions = domainSchema.table("definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  version: integer("version").notNull().default(1),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const definitionNodes = domainSchema.table("definition_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  definitionId: uuid("definition_id").notNull(),
  nodeKey: varchar("node_key", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  roleRef: varchar("role_ref", { length: 128 }),
  sortOrder: integer("sort_order").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DefinitionRow = typeof definitions.$inferSelect;
export type DefinitionNodeRow = typeof definitionNodes.$inferSelect;

export const schema = { definitions, definitionNodes };
