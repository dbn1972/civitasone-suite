/**
 * did module — DID-to-tenant mapping in schema `telephony`.
 *
 * Maps inbound dialed numbers (DIDs) to tenants. When an inbound call arrives,
 * the calleeNumber is looked up here to determine which tenant owns that number.
 * If no mapping exists, DEFAULT_TENANT_ID (env or fallback) is used.
 */
import { pgSchema, uuid, varchar, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("telephony");

export const didMappings = domainSchema.table("did_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  didNumber: varchar("did_number", { length: 32 }).notNull(),
  label: varchar("label", { length: 160 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type DidMappingRow = typeof didMappings.$inferSelect;
export type DidMappingInsert = typeof didMappings.$inferInsert;

export type DidMappingView = {
  id: string;
  tenantId: string;
  didNumber: string;
  label: string | null;
  active: boolean;
  createdAt: string;
  version: number;
};

export const schema = { didMappings };
