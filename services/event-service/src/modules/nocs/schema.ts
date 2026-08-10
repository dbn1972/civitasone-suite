import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const eventSchema = pgSchema("event");

export const eventNocRequests = eventSchema.table("event_noc_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  department: varchar("department", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("requested"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  conditions: jsonb("conditions").$type<Record<string, unknown>>(),
  officerId: uuid("officer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type NocRequestRow = typeof eventNocRequests.$inferSelect;
export type NocRequestInsert = typeof eventNocRequests.$inferInsert;

export const schema = { eventNocRequests };
