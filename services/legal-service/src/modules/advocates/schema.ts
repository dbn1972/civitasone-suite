import { uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { counselSchema } from "../counsel/schema.js";

/** GAP-LEGAL-LIST-04 (owner decision #14): the tenant's empanelled-advocate master. */
export const empanelledAdvocates = counselSchema.table("empanelled_advocates", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  name:            text("name").notNull(),
  barEnrolmentNo:  text("bar_enrolment_no").notNull(),
  contact:         text("contact").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type AdvocateRow = typeof empanelledAdvocates.$inferSelect;
export const schema = { empanelledAdvocates };
