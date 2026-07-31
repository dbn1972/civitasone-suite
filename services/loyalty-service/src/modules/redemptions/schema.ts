import { pgSchema, uuid, varchar, integer, timestamp, bigint } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("loyalty");

export const redemptions = domainSchema.table("redemptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  memberId: uuid("member_id").notNull(),
  points: bigint("points", { mode: "bigint" }).notNull(),
  rewardType: varchar("reward_type", { length: 50 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RedemptionRow = typeof redemptions.$inferSelect;
export type RedemptionInsert = typeof redemptions.$inferInsert;

export const schema = { redemptions };
