/**
 * visitor-service: digital-pass Drizzle schema (migration 0002).
 *
 * Mirrors `services/visitor-service/migrations/0002_visit_requests_digital_passes.sql`
 * exactly (column names, types, defaults, nullability, unique constraint) for
 * `visitor.digital_passes`.
 *
 * `replacedById` self-references `digitalPasses.id` (nullable FK, set when a
 * pass is replaced — see `modules/digital-pass/domain.ts`, task 7.2).
 *
 * `visitorSchema` is defined here via its own `pgSchema("visitor")` call —
 * per the established CivitasOne pattern, multiple module `schema.ts` files
 * each call `pgSchema("visitor")` independently (see e.g.
 * `modules/blacklist/schema.ts`); Drizzle treats same-named `pgSchema()`
 * calls as referring to the same Postgres schema.
 */
import { pgSchema, uuid, varchar, text, integer, boolean, timestamp, jsonb, unique } from "drizzle-orm/pg-core";

export const visitorSchema = pgSchema("visitor");

export const digitalPasses = visitorSchema.table(
  "digital_passes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    visitRequestId: uuid("visit_request_id").notNull(),
    locationId: uuid("location_id").notNull(),
    passNumber: varchar("pass_number", { length: 12 }).notNull(), // human-readable
    status: varchar("status", { length: 16 }).notNull().default("active"),
    // status: active | checked_in | checked_out | revoked | expired
    passType: varchar("pass_type", { length: 16 }).notNull(),
    // pass_type: single | multi_day | recurring | event
    qrJwt: text("qr_jwt").notNull(), // signed JWT for QR
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    permittedAreas: jsonb("permitted_areas").$type<string[]>().notNull().default([]),
    revoked: boolean("revoked").notNull().default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
    replacedById: uuid("replaced_by_id"), // self-FK: points to the replacement pass
    escortEmployeeId: uuid("escort_employee_id"), // for restricted areas
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => ({
    tenantPassNumberUnique: unique("digital_passes_tenant_id_pass_number_key").on(table.tenantId, table.passNumber),
  }),
);

export type DigitalPassRow = typeof digitalPasses.$inferSelect;
export type DigitalPassInsert = typeof digitalPasses.$inferInsert;

export const schema = { digitalPasses };
