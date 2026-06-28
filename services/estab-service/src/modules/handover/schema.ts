import {
  pgSchema, uuid, text, integer, timestamp,
} from "drizzle-orm/pg-core";

export const filesSchema = pgSchema("files");

export const estabChargeHandover = filesSchema.table("estab_charge_handover", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  fromOfficerId: uuid("from_officer_id").notNull(),
  toOfficerId:   uuid("to_officer_id").notNull(),
  reason:        text("reason").notNull().default("transfer"),
  remarks:       text("remarks"),
  fileCount:     integer("file_count").notNull().default(0),
  status:        text("status").notNull().default("pending"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  completedAt:   timestamp("completed_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type HandoverRow = typeof estabChargeHandover.$inferSelect;
export type HandoverInsert = typeof estabChargeHandover.$inferInsert;

export const schema = { estabChargeHandover };
