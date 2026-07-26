import { pgSchema, uuid, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

/** CAP-035 — a named, saved filter over the task pool. */
export const workbaskets = domainSchema.table("workbaskets", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  code:        varchar("code", { length: 64 }).notNull(),
  name:        varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 500 }),
  filter:      jsonb("filter").$type<Record<string, unknown>>().notNull().default({}),
  sortOrder:   varchar("sort_order", { length: 64 }).notNull().default("created_at"),
  createdBy:   uuid("created_by").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkbasketRow = typeof workbaskets.$inferSelect;

export const schema = { workbaskets };
