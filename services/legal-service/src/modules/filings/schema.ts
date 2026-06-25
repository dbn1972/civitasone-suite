import { pgSchema, uuid, text, integer, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const filingsSchema = pgSchema("filings");

export const legalFilings = filingsSchema.table("legal_filings", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  caseId:      uuid("case_id").notNull(),
  filingType:  varchar("filing_type", { length: 32 }).notNull(),
  title:       text("title").notNull(),
  court:       text("court").notNull(),
  filingDate:  date("filing_date").notNull(),
  referenceNo: text("reference_no"),
  status:      varchar("status", { length: 24 }).notNull().default("drafted"),
  filedAt:     timestamp("filed_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type FilingRow = typeof legalFilings.$inferSelect;
export type FilingInsert = typeof legalFilings.$inferInsert;
export const schema = { legalFilings };
