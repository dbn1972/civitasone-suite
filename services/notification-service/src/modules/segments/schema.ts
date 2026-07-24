import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const segmentsSchema = pgSchema("segments");

export const recipientSegments = segmentsSchema.table("recipient_segments", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  name:        varchar("name", { length: 128 }).notNull(),
  description: varchar("description", { length: 512 }),
  criteria:    jsonb("criteria").notNull(),
  cachedCount: integer("cached_count"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type RecipientSegmentRow = typeof recipientSegments.$inferSelect;
export type RecipientSegmentInsert = typeof recipientSegments.$inferInsert;

export const segmentsModuleSchema = { recipientSegments };
