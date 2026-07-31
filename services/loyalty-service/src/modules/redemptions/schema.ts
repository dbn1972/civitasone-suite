import { pgSchema, uuid, varchar, integer, timestamp, bigint } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("loyalty");

export const redemptions = domainSchema.table("redemptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  // Legacy denormalised link to the CDP profile, kept because
  // (tenant_id, member_id) is still indexed and queried. Nullable since 0004:
  // rows created through the enrolment path may not know the profile id.
  memberId: uuid("member_id"),
  enrolmentId: uuid("enrolment_id"),
  points: bigint("points", { mode: "bigint" }).notNull(),
  rewardType: varchar("reward_type", { length: 50 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: varchar("void_reason", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by"),
  version: integer("version").notNull().default(1),
});

export type RedemptionRow = typeof redemptions.$inferSelect;
export type RedemptionInsert = typeof redemptions.$inferInsert;

export const schema = { redemptions };
