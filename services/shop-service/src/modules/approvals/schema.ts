import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const shopSchema = pgSchema("shop");

export const scrutinyRecords = shopSchema.table("scrutiny_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  scrutinyType: varchar("scrutiny_type", { length: 32 }).notNull(),
  officerId: uuid("officer_id").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  findings: jsonb("findings").$type<Record<string, unknown>>(),
  deficiencyDetails: text("deficiency_details"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ScrutinyRecordRow = typeof scrutinyRecords.$inferSelect;
export type ScrutinyRecordInsert = typeof scrutinyRecords.$inferInsert;

export const schema = { scrutinyRecords };
