import {
  pgSchema, uuid, text, integer, varchar, date, timestamp,
} from "drizzle-orm/pg-core";

// RTI register lives in the lifecycle schema alongside other HR registers.
export const rtiSchema = pgSchema("lifecycle");

export const hrmsRtiRequests = rtiSchema.table("hrms_rti_requests", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  referenceNo:      varchar("reference_no", { length: 64 }).notNull(),
  applicantName:    text("applicant_name").notNull(),
  applicantContact: text("applicant_contact"),
  subject:          text("subject").notNull(),
  requestText:      text("request_text").notNull(),
  receivedDate:     date("received_date").notNull(),
  dueDate:          date("due_date").notNull(),
  pioId:            uuid("pio_id"),
  status:           varchar("status", { length: 24 }).notNull().default("filed"),
  responseText:     text("response_text"),
  respondedDate:    date("responded_date"),
  appealText:       text("appeal_text"),
  appealDate:       date("appeal_date"),
  closedDate:       date("closed_date"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export type RtiRow = typeof hrmsRtiRequests.$inferSelect;

export const schema = { hrmsRtiRequests };
