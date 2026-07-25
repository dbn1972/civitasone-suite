import { pgSchema, uuid, text, integer, varchar, timestamp } from "drizzle-orm/pg-core";

/**
 * SVC-050 GeM / CPPP integration — outbound/inbound exchange references for
 * tender / order / AOC entities, with reconciliation state. Lives in the
 * `procurement` schema (owned by the service).
 */
export const gemSchema = pgSchema("procurement");

export const procurementGemIntegrationRefs = gemSchema.table("gem_integration_refs", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  provider:       varchar("provider", { length: 8 }).notNull().default("gem"),
  entityType:     varchar("entity_type", { length: 16 }).notNull(),
  entityId:       text("entity_id").notNull(),
  direction:      varchar("direction", { length: 12 }).notNull().default("outbound"),
  externalRef:    text("external_ref"),
  externalStatus: varchar("external_status", { length: 32 }),
  status:         varchar("status", { length: 16 }).notNull().default("pending"),
  attempts:       integer("attempts").notNull().default(0),
  lastError:      text("last_error"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type GemRefRow    = typeof procurementGemIntegrationRefs.$inferSelect;
export type GemRefInsert = typeof procurementGemIntegrationRefs.$inferInsert;

export const schema = { procurementGemIntegrationRefs };
