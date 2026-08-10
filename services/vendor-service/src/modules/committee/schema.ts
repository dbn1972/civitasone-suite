import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const vendorSchema = pgSchema("vendor");

export const vendorCommitteeReviews = vendorSchema.table("vendor_committee_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  registrationId: uuid("registration_id").notNull(),
  committeeType: varchar("committee_type", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  findings: jsonb("findings").$type<Record<string, unknown>>(),
  recommendation: text("recommendation"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type CommitteeReviewRow = typeof vendorCommitteeReviews.$inferSelect;
export type CommitteeReviewInsert = typeof vendorCommitteeReviews.$inferInsert;

export const schema = { vendorCommitteeReviews };
