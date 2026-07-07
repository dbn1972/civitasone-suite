import { pgSchema, uuid, varchar, integer, bigint, char, timestamp, date } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const deals = crmSchema.table("deals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  pipelineId: uuid("pipeline_id"),
  stageId: uuid("stage_id"),
  name: varchar("name", { length: 200 }).notNull(),
  stage: varchar("stage", { length: 24 }).notNull().default("Lead"),
  valueMinor: bigint("value_minor", { mode: "bigint" }).notNull().default(0n),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  contactId: uuid("contact_id"),
  ownerId: uuid("owner_id"),
  closeDate: date("close_date"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  probability: integer("probability").notNull().default(0),
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
  pipelineId: string | null;
  stageId: string | null;
  name: string;
  stage: string;
  valueMinor: string;
  currency: string;
  valueDisplay: string;
  contactId: string | null;
  contactName: string | null;
  ownerId: string | null;
  closeDate: string | null;
  closedAt: string | null;
  probability: number;
  status: string;
  version: number;
};

export const schema = { deals };
