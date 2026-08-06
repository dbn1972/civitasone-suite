import { pgSchema, uuid, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const segmentEligibilityRules = crmSchema.table("segment_eligibility_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  segmentCode: varchar("segment_code", { length: 64 }).notNull(),
  productId: uuid("product_id").notNull(),
  eligible: boolean("eligible").notNull().default(true),
  channelOverride: jsonb("channel_override").$type<string[] | null>(),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SegmentEligibilityRuleRow = typeof segmentEligibilityRules.$inferSelect;
export type SegmentEligibilityRuleInsert = typeof segmentEligibilityRules.$inferInsert;

export type SegmentEligibilityRuleView = {
  id: string;
  tenantId: string;
  segmentCode: string;
  productId: string;
  eligible: boolean;
  channelOverride: string[] | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const schema = { segmentEligibilityRules };
