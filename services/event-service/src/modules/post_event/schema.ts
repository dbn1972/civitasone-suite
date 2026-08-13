import { pgSchema, uuid, varchar, integer, bigint, timestamp, jsonb } from "drizzle-orm/pg-core";

export const eventSchema = pgSchema("event");

export const eventPostInspections = eventSchema.table("event_post_inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  permitId: uuid("permit_id").notNull(),
  inspectorId: uuid("inspector_id").notNull(),
  inspectedAt: timestamp("inspected_at", { withTimezone: true }),
  findings: jsonb("findings").$type<Record<string, unknown>>(),
  damageAssessment: jsonb("damage_assessment").$type<Record<string, unknown>>(),
  depositDecision: varchar("deposit_decision", { length: 32 }),
  refundMinor: bigint("refund_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type PostInspectionRow = typeof eventPostInspections.$inferSelect;
export type PostInspectionInsert = typeof eventPostInspections.$inferInsert;

export const schema = { eventPostInspections };
