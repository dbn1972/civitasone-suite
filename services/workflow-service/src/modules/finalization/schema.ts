import { pgSchema, uuid, varchar, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

/** CAP-029 — finalization/reversal state for an instance (one row per instance). */
export const instanceFinalizations = domainSchema.table("instance_finalizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  instanceId: uuid("instance_id").notNull(),
  finalizedBy: uuid("finalized_by").notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
  reversed: boolean("reversed").notNull().default(false),
  reversedBy: uuid("reversed_by"),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  reversalReason: varchar("reversal_reason", { length: 512 }),
  impact: jsonb("impact").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InstanceFinalizationRow = typeof instanceFinalizations.$inferSelect;

export const schema = { instanceFinalizations };
