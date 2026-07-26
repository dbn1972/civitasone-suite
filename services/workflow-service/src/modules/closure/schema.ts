import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

/** CAP-040 — closure/reopen/archival state for any (entityType, entityId). */
export const entityClosures = domainSchema.table("entity_closures", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  entityType:    varchar("entity_type", { length: 48 }).notNull(),
  entityId:      uuid("entity_id").notNull(),
  status:        varchar("status", { length: 12 }).notNull().default("open"),
  closedBy:      uuid("closed_by"),
  closedAt:      timestamp("closed_at", { withTimezone: true }),
  closureReason: varchar("closure_reason", { length: 1000 }),
  reopenedBy:    uuid("reopened_by"),
  reopenedAt:    timestamp("reopened_at", { withTimezone: true }),
  reopenReason:  varchar("reopen_reason", { length: 1000 }),
  archivedBy:    uuid("archived_by"),
  archivedAt:    timestamp("archived_at", { withTimezone: true }),
  reopenCount:   integer("reopen_count").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClosureRow = typeof entityClosures.$inferSelect;

export const schema = { entityClosures };
