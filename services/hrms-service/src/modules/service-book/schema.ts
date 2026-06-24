import { pgSchema, uuid, text, varchar, date, timestamp, boolean } from "drizzle-orm/pg-core";

export const serviceBookSchema = pgSchema("lifecycle");

export const hrmsServiceBookEntries = serviceBookSchema.table("hrms_service_book_entries", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  entryType:     varchar("entry_type", { length: 30 }).notNull(),
  effectiveDate: date("effective_date").notNull(),
  description:   text("description").notNull(),
  recordedBy:    uuid("recorded_by").notNull(),
  documentRef:   varchar("document_ref", { length: 100 }),
  attested:      boolean("attested").notNull().default(false),
  attestedBy:    uuid("attested_by"),
  attestedAt:    timestamp("attested_at", { withTimezone: true }),
  attestRemarks: text("attest_remarks"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceBookRow = typeof hrmsServiceBookEntries.$inferSelect;

export const schema = { hrmsServiceBookEntries };
