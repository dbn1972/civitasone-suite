import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

export const tasks = domainSchema.table("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  instanceId: uuid("instance_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  roleRef: varchar("role_ref", { length: 128 }),
  refType: varchar("ref_type", { length: 64 }),
  refId: uuid("ref_id"),
  decision: varchar("decision", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;

export type TaskView = {
  id: string;
  tenantId: string;
  instanceId: string;
  name: string;
  status: string;
  roleRef?: string | null;
  refType?: string | null;
  refId?: string | null;
  decision?: string | null;
  version: number;
};

export const schema = { tasks };
