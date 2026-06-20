import { pgSchema, uuid, varchar, integer, bigint, char, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const deals = crmSchema.table("deals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  stage: varchar("stage", { length: 24 }).notNull().default("Lead"),
  valueMinor: bigint("value_minor", { mode: "bigint" }).notNull().default(0n),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type DealRow = typeof deals.$inferSelect;
export type DealInsert = typeof deals.$inferInsert;

export type DealView = {
  id: string;
  tenantId: string;
  name: string;
  stage: string;
  valueMinor: string;
  currency: string;
  valueDisplay: string;
  status: string;
  version: number;
};

export const schema = { deals };
