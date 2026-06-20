import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const installSchema = pgSchema("install");

export const stages = installSchema.table("stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  stepNumber: integer("step_number").notNull(),
  description: varchar("description", { length: 500 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type StageRow = typeof stages.$inferSelect;
export type StageInsert = typeof stages.$inferInsert;

export type StageView = {
  id: string;
  tenantId: string;
  name: string;
  stepNumber: number;
  description: string | null;
  status: string;
  version: number;
};

export const schema = { stages };
