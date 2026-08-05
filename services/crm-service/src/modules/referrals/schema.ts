import { pgSchema, uuid, varchar, timestamp, boolean } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const referrals = crmSchema.table("referrals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  referrerId: uuid("referrer_id").notNull(),
  referredContactId: uuid("referred_contact_id").notNull(),
  sourceSystem: varchar("source_system", { length: 64 }),
  externalRef: varchar("external_ref", { length: 200 }),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  conversionDealId: uuid("conversion_deal_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  credited: boolean("credited").notNull().default(false),
});

export type ReferralRow = typeof referrals.$inferSelect;

export const schema = { referrals };
