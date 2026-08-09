import { pgSchema, uuid, varchar, date, jsonb, integer, timestamp } from "drizzle-orm/pg-core";

const fireNocs = pgSchema("fire_nocs");

export const fireNocsTable = fireNocs.table("fire_nocs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  nocNumber: varchar("noc_number", { length: 64 }).notNull().unique(),
  applicationId: uuid("application_id").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("issued"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  validFrom: date("valid_from"),
  validUntil: date("valid_until"),
  conditions: jsonb("conditions"),
  verificationCode: varchar("verification_code", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type FireNocRow = typeof fireNocsTable.$inferSelect;
export type FireNocInsert = typeof fireNocsTable.$inferInsert;

export const schema = { fireNocs: fireNocsTable };
