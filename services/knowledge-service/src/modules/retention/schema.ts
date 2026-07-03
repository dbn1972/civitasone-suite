import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const knowledgeSchema = pgSchema("knowledge");

export const retentionPolicies = knowledgeSchema.table("retention_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  categoryId: uuid("category_id"),
  retentionYears: integer("retention_years").notNull(),
  retentionDays: integer("retention_days").notNull().default(0),
  action: varchar("action", { length: 24 }).notNull().default("archive"),
  notifyBefore: integer("notify_before_days").notNull().default(90),
  reminderMonths: integer("reminder_months").notNull().default(3),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RetentionPolicyRow = typeof retentionPolicies.$inferSelect;
export type RetentionPolicyInsert = typeof retentionPolicies.$inferInsert;

export type RetentionPolicyView = {
  id: string;
  tenantId: string;
  name: string;
  categoryId: string | null;
  retentionYears: number;
  retentionDays: number;
  action: string;
  notifyBefore: number;
  reminderMonths: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  version: number;
};

export const schema = { retentionPolicies };
