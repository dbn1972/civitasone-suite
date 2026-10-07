import { pgSchema, uuid, text, varchar, integer, timestamp } from "drizzle-orm/pg-core";

// GAP-CITIZEN-RTI-03 — CPIO / public-authority directory lives in the existing
// `rti` schema (same bounded context as the RTI requests that reference it).
export const rtiSchema = pgSchema("rti");

export const cpioDirectory = rtiSchema.table("cpio_directory", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  name:            text("name").notNull(),
  designation:     text("designation"),
  publicAuthority: text("public_authority").notNull(),
  department:      text("department"),
  email:           text("email"),
  phone:           text("phone"),
  status:          varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type CpioRow    = typeof cpioDirectory.$inferSelect;
export type CpioInsert = typeof cpioDirectory.$inferInsert;

export const schema = { cpioDirectory };
