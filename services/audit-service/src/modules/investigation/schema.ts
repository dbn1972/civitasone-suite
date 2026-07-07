import { pgSchema, uuid, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";

export const investigationSchema = pgSchema("investigation");

export const investigations = investigationSchema.table("investigations", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  caseId:      text("case_id").notNull(),
  subject:     text("subject").notNull(),
  assignedTo:  text("assigned_to").notNull(),
  started:     timestamp("started", { withTimezone: true }).notNull().defaultNow(),
  findings:    text("findings").notNull().default(""),
  status:      varchar("status", { length: 24 }).notNull().default("in_progress"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type InvestigationRow = typeof investigations.$inferSelect;
export type InvestigationInsert = typeof investigations.$inferInsert;
