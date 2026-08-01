/**
 * dsar module — Drizzle schema. CDP-011 register of Data Subject Access Requests.
 *
 * The register exists so a tenant can evidence, per DPDP Act 2023 §§11-13, that a
 * request was received and discharged: completion is a recorded state transition that
 * emits `cdp.dsar.completed`, which is what makes downstream segment/activation purge
 * auditable rather than best-effort.
 */
import { pgSchema, uuid, varchar, integer, timestamp, text } from "drizzle-orm/pg-core";

export const cdpSchema = pgSchema("cdp");

export const dsarRequests = cdpSchema.table("dsar_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  requestType: varchar("request_type", { length: 24 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  reason: text("reason"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
});

export type DsarRequestRow = typeof dsarRequests.$inferSelect;
export type DsarRequestInsert = typeof dsarRequests.$inferInsert;

export const schema = { dsarRequests };
