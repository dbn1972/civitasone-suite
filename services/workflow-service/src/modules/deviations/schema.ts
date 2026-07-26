import { pgSchema, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

/** CAP-039 — a deviation/waiver request with maker-checker approval lifecycle. */
export const deviationRequests = domainSchema.table("deviation_requests", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  entityType:    varchar("entity_type", { length: 48 }).notNull(),
  entityId:      uuid("entity_id").notNull(),
  deviationType: varchar("deviation_type", { length: 48 }).notNull(),
  reason:        text("reason").notNull(),
  status:        varchar("status", { length: 16 }).notNull().default("pending"),
  requestedBy:   uuid("requested_by").notNull(),
  reviewedBy:    uuid("reviewed_by"),
  reviewedAt:    timestamp("reviewed_at", { withTimezone: true }),
  reviewNote:    varchar("review_note", { length: 1000 }),
  expiresAt:     timestamp("expires_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviationRow = typeof deviationRequests.$inferSelect;

export const schema = { deviationRequests };
