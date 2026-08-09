import { pgSchema, uuid, varchar, integer, timestamp, text } from "drizzle-orm/pg-core";

const drainageSchema = pgSchema("civitas_drainage");

export const drainageFieldActions = drainageSchema.table("drainage_field_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  complaintId: uuid("complaint_id").notNull(),
  actionType: varchar("action_type", { length: 32 }).notNull(),
  performedBy: uuid("performed_by").notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
  drainAssetRef: text("drain_asset_ref"),
  notes: text("notes"),
  beforePhoto: text("before_photo"),
  afterPhoto: text("after_photo"),
  durationMinutes: integer("duration_minutes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type FieldActionRow = typeof drainageFieldActions.$inferSelect;
export type FieldActionInsert = typeof drainageFieldActions.$inferInsert;
export const schema = { drainageFieldActions };
