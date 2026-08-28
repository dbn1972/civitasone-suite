import { pgSchema, uuid, varchar, integer, timestamp, jsonb, date } from "drizzle-orm/pg-core";

export const roadcutSchema = pgSchema("roadcut");

export const roadcutPermits = roadcutSchema.table("roadcut_permits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  permitNumber: varchar("permit_number", { length: 64 }).notNull().unique(),
  // One ACTIVE permit per application is enforced at the DB level via a
  // partial unique index (migration 0002_permit_restoration_unique_constraints.sql,
  // WHERE status != 'cancelled') rather than a plain column constraint here —
  // a cancelled permit must not block a legitimate re-issuance for the same
  // application, which a bare .unique() would incorrectly forbid.
  applicationId: uuid("application_id").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("issued"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  workStartDate: date("work_start_date").notNull(),
  workEndDate: date("work_end_date").notNull(),
  extendedUntil: date("extended_until"),
  conditions: jsonb("conditions").$type<Record<string, unknown>>(),
  verificationCode: varchar("verification_code", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RoadcutPermitRow = typeof roadcutPermits.$inferSelect;
export type RoadcutPermitInsert = typeof roadcutPermits.$inferInsert;

export const schema = { roadcutPermits };
