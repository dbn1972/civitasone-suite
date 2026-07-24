import {
  pgSchema, uuid, text, integer, varchar, date, timestamp,
} from "drizzle-orm/pg-core";

// SVC-121 — training administration extends the existing `training` schema
// (see modules/training/schema.ts for hrms_trainings / hrms_nominations).
const trainingSchema = pgSchema("training");

export const trainingSessions = trainingSchema.table("hrms_training_sessions", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  trainingId: uuid("training_id").notNull(),
  title:      text("title").notNull(),
  sessionDate: date("session_date").notNull(),
  startTime:  varchar("start_time", { length: 5 }),
  endTime:    varchar("end_time", { length: 5 }),
  venue:      text("venue"),
  capacity:   integer("capacity").notNull().default(30),
  status:     varchar("status", { length: 16 }).notNull().default("scheduled"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
});

export const sessionAttendance = trainingSchema.table("hrms_session_attendance", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  sessionId:  uuid("session_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  status:     varchar("status", { length: 12 }).notNull().default("present"),
  markedAt:   timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  markedBy:   uuid("marked_by").notNull(),
});

export type TrainingSessionRow = typeof trainingSessions.$inferSelect;
export type SessionAttendanceRow = typeof sessionAttendance.$inferSelect;

export const schema = { trainingSessions, sessionAttendance };
