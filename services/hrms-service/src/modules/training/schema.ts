import {
  pgSchema, uuid, text, integer, varchar, date, timestamp,
} from "drizzle-orm/pg-core";

export const trainingSchema = pgSchema("training");

export const hrmsTrainings = trainingSchema.table("hrms_trainings", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  title:           text("title").notNull(),
  venue:           text("venue"),
  fromDate:        date("from_date").notNull(),
  toDate:          date("to_date").notNull(),
  facilitator:     text("facilitator"),
  maxParticipants: integer("max_participants").notNull().default(30),
  status:          varchar("status", { length: 24 }).notNull().default("planned"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const hrmsNominations = trainingSchema.table("hrms_nominations", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  trainingId:    uuid("training_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  status:        varchar("status", { length: 24 }).notNull().default("nominated"),
  certificateRef: text("certificate_ref"),
  completedDate: date("completed_date"),
  score:         integer("score"),
  result:        varchar("result", { length: 16 }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type NominationRow = typeof hrmsNominations.$inferSelect;

export const schema = { hrmsTrainings, hrmsNominations };
