import { pgSchema, uuid, text, varchar, date, timestamp } from "drizzle-orm/pg-core";

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
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { hrmsServiceBookEntries };
