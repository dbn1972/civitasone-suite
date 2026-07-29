import { uuid, varchar, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { recruitmentSchema } from "./schema.js";

export const hrmsReservationRosters = recruitmentSchema.table("hrms_reservation_rosters", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  jobOpeningId:      uuid("job_opening_id").notNull(),
  totalVacancies:    integer("total_vacancies").notNull(),
  categoryVacancies: jsonb("category_vacancies").$type<Record<string, number>>().notNull().default({}),
  locationRosters:   jsonb("location_rosters").$type<Record<string, Record<string, number>>>().notNull().default({}),
  status:            varchar("status", { length: 16 }).notNull().default("draft"),
  approvedBy:        uuid("approved_by"),
  approvedAt:        timestamp("approved_at", { withTimezone: true }),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReservationRosterRow = typeof hrmsReservationRosters.$inferSelect;
export type ReservationRosterInsert = typeof hrmsReservationRosters.$inferInsert;

export const schema = { hrmsReservationRosters };
