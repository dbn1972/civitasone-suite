import { pgSchema, uuid, varchar, text, bigint, integer, timestamp, jsonb, date } from "drizzle-orm/pg-core";

export const advEnforcementSchema = pgSchema("adv_enforcement");

export const advViolations = advEnforcementSchema.table("adv_violations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  violationNumber: varchar("violation_number", { length: 64 }).notNull().unique(),
  permitId: uuid("permit_id"),
  status: varchar("status", { length: 32 }).notNull().default("reported"),
  violationType: varchar("violation_type", { length: 64 }).notNull(),
  description: text("description").notNull(),
  location: jsonb("location").$type<{ address: string; lat?: number; lng?: number; ward?: string }>().notNull(),
  reportedBy: uuid("reported_by").notNull(),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  noticeIssuedAt: timestamp("notice_issued_at", { withTimezone: true }),
  noticeDetails: jsonb("notice_details"),
  penaltyMinor: bigint("penalty_minor", { mode: "bigint" }),
  penaltyCurrency: varchar("penalty_currency", { length: 3 }).default("INR"),
  penaltyImposedAt: timestamp("penalty_imposed_at", { withTimezone: true }),
  removalOrderedAt: timestamp("removal_ordered_at", { withTimezone: true }),
  removalDeadline: date("removal_deadline"),
  removalRecordedAt: timestamp("removal_recorded_at", { withTimezone: true }),
  removalNotes: text("removal_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AdvViolationRow = typeof advViolations.$inferSelect;
export type AdvViolationInsert = typeof advViolations.$inferInsert;

export const schema = { advViolations };
