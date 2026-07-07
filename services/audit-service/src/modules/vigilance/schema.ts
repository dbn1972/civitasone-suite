import { pgSchema, uuid, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";

export const vigilanceSchema = pgSchema("vigilance");

export const vigilanceCases = vigilanceSchema.table("vigilance_cases", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  caseNo:          text("case_no").notNull(),
  officer:         text("officer").notNull(),
  charges:         text("charges").notNull(),
  inquiryStatus:   varchar("inquiry_status", { length: 32 }).notNull().default("preliminary_enquiry"),
  outcome:         varchar("outcome", { length: 24 }).notNull().default("pending"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type VigilanceCaseRow = typeof vigilanceCases.$inferSelect;
export type VigilanceCaseInsert = typeof vigilanceCases.$inferInsert;
