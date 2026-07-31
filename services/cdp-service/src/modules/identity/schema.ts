/**
 * identity module — Drizzle schema. Identity graph for cross-source resolution.
 */
import { pgSchema, uuid, varchar, integer, timestamp, numeric } from "drizzle-orm/pg-core";

export const cdpSchema = pgSchema("cdp");

export const identityGraph = cdpSchema.table("identity_graph", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  identifierType: varchar("identifier_type", { length: 64 }).notNull(),
  identifierHash: varchar("identifier_hash", { length: 256 }).notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull().default("1.0000"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type IdentityGraphRow = typeof identityGraph.$inferSelect;
export type IdentityGraphInsert = typeof identityGraph.$inferInsert;

export const schema = { identityGraph };
