import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

export const instances = domainSchema.table("instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  definitionId: uuid("definition_id"),
  definitionVersion: integer("definition_version"),
  refType: varchar("ref_type", { length: 64 }),
  refId: uuid("ref_id"),
  currentNode: varchar("current_node", { length: 64 }),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type InstanceRow = typeof instances.$inferSelect;
export type InstanceInsert = typeof instances.$inferInsert;

export type InstanceView = {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  definitionId?: string | null;
  refType?: string | null;
  refId?: string | null;
  currentNode?: string | null;
  version: number;
};

export const schema = { instances };
