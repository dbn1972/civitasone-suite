/**
 * Contractor module schema — works.contractors table.
 * Stores registered contractors with class, contact details, and performance rating.
 * PG schema: `works` (same schema as all other works tables).
 */
import { pgSchema, uuid, varchar, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

const works = pgSchema("works");

export const contractors = works.table("contractors", {
  id:              uuid("id").primaryKey(),
  tenantId:        uuid("tenant_id").notNull(),
  name:            varchar("name", { length: 256 }).notNull(),
  registrationNo:  varchar("registration_no", { length: 64 }),
  classId:         uuid("class_id"),
  pan:             varchar("pan", { length: 10 }),
  gst:             varchar("gst", { length: 15 }),
  email:           varchar("email", { length: 256 }),
  phone:           varchar("phone", { length: 20 }),
  address:         text("address"),
  /** 1–5 rating, averaged from ratings */
  performanceRating: integer("performance_rating"),
  ratingCount:     integer("rating_count").notNull().default(0),
  active:          boolean("active").notNull().default(true),
  version:         integer("version").notNull().default(1),
  createdBy:       uuid("created_by").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:       uuid("updated_by").notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContractorRow    = typeof contractors.$inferSelect;
export type ContractorInsert = typeof contractors.$inferInsert;
export const schema = { contractors };
