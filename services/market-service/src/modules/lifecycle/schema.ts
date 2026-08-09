import { pgSchema, uuid, varchar, integer, timestamp, text } from "drizzle-orm/pg-core";

const marketSchema = pgSchema("market");

export const marketLifecycleRequests = marketSchema.table("market_lifecycle_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  allotmentId: uuid("allotment_id").notNull(),
  requestNumber: text("request_number").notNull().unique(),
  requestType: varchar("request_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("submitted"),
  transfereeName: text("transferee_name"),
  transfereeAadhaar: varchar("transferee_aadhaar", { length: 12 }),
  reason: text("reason"),
  approvedBy: uuid("approved_by"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type LifecycleRequestRow = typeof marketLifecycleRequests.$inferSelect;
export type LifecycleRequestInsert = typeof marketLifecycleRequests.$inferInsert;

export const schema = { marketLifecycleRequests };
