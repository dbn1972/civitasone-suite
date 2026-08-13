import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const advApprovalsSchema = pgSchema("adv_approvals");

export const advScrutinyRecords = advApprovalsSchema.table("adv_scrutiny_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  scrutinyType: varchar("scrutiny_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  findings: jsonb("findings").$type<Record<string, unknown>>(),
  officerId: uuid("officer_id").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AdvScrutinyRow = typeof advScrutinyRecords.$inferSelect;
export type AdvScrutinyInsert = typeof advScrutinyRecords.$inferInsert;

export const schema = { advScrutinyRecords };
