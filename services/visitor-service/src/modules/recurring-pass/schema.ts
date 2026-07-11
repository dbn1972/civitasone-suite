/**
 * visitor-service: recurring-pass Drizzle schema (migration 0005).
 *
 * Mirrors `services/visitor-service/migrations/0005_group_recurring.sql`
 * exactly (column names, types, defaults, nullability, check constraint,
 * indexes) for `visitor.recurring_passes`.
 *
 * `visitorName` / `visitorPhone` are DPDP-encrypted PII (AES-256-GCM
 * envelope via `encryptedText()`), matching the convention used elsewhere in
 * this schema (e.g. `modules/visit-request/schema.ts`).
 *
 * `visitorSchema` is defined here via its own `pgSchema("visitor")` call —
 * per the established CivitasOne multi-module pattern, each module's
 * `schema.ts` independently calls `pgSchema("visitor")`; Drizzle treats
 * same-named `pgSchema()` calls as referring to the same Postgres schema.
 */
import { pgSchema, uuid, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const visitorSchema = pgSchema("visitor");

export const recurringPasses = visitorSchema.table("recurring_passes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  locationId: uuid("location_id").notNull(),
  passId: uuid("pass_id").notNull(),
  // PII fields (encrypted at rest, AES-256-GCM envelope via encryptedText())
  visitorName: encryptedText("visitor_name").notNull(),
  visitorPhone: encryptedText("visitor_phone").notNull(),
  companyName: varchar("company_name", { length: 200 }),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  permittedDays: jsonb("permitted_days").$type<number[]>().notNull(), // array of ints, 0=Sun..6=Sat
  permittedTimeFrom: varchar("permitted_time_from", { length: 5 }),
  permittedTimeTo: varchar("permitted_time_to", { length: 5 }),
  status: varchar("status", { length: 12 }).notNull().default("active"),
  // status: active | suspended | revoked | expired
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendReason: text("suspend_reason"),
  issuedBy: uuid("issued_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RecurringPassRow = typeof recurringPasses.$inferSelect;
export type RecurringPassInsert = typeof recurringPasses.$inferInsert;

export const schema = { recurringPasses };
