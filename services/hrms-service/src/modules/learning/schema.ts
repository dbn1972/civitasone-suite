import {
  pgSchema, uuid, text, integer, numeric, varchar, timestamp,
} from "drizzle-orm/pg-core";

export const learningSchema = pgSchema("learning");

export const courses = learningSchema.table("courses", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  code:        varchar("code", { length: 32 }).notNull(),
  title:       text("title").notNull(),
  description: text("description"),
  category:    varchar("category", { length: 64 }).notNull().default("general"),
  creditHours: numeric("credit_hours").notNull().default("0"),
  status:      varchar("status", { length: 16 }).notNull().default("draft"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});

export const coursePrerequisites = learningSchema.table("course_prerequisites", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  courseId:             uuid("course_id").notNull(),
  prerequisiteCourseId: uuid("prerequisite_course_id").notNull(),
});

export const modules = learningSchema.table("modules", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  courseId:  uuid("course_id").notNull(),
  title:     text("title").notNull(),
  sequence:  integer("sequence").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lessons = learningSchema.table("lessons", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  moduleId:     uuid("module_id").notNull(),
  courseId:     uuid("course_id").notNull(),
  title:        text("title").notNull(),
  sequence:     integer("sequence").notNull().default(1),
  contentType:  varchar("content_type", { length: 12 }).notNull().default("link"),
  contentUri:   text("content_uri"),
  durationMins: integer("duration_mins").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const enrollments = learningSchema.table("enrollments", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  courseId:       uuid("course_id").notNull(),
  employeeId:     uuid("employee_id").notNull(),
  status:         varchar("status", { length: 16 }).notNull().default("enrolled"),
  progressPct:    integer("progress_pct").notNull().default(0),
  resumeLessonId: uuid("resume_lesson_id"),
  enrolledAt:     timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:    timestamp("completed_at", { withTimezone: true }),
});

export const lessonProgress = learningSchema.table("lesson_progress", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  enrollmentId: uuid("enrollment_id").notNull(),
  lessonId:     uuid("lesson_id").notNull(),
  status:       varchar("status", { length: 12 }).notNull().default("completed"),
  completedAt:  timestamp("completed_at", { withTimezone: true }),
});

export type CourseRow = typeof courses.$inferSelect;
export type ModuleRow = typeof modules.$inferSelect;
export type LessonRow = typeof lessons.$inferSelect;
export type EnrollmentRow = typeof enrollments.$inferSelect;

export const schema = {
  courses, coursePrerequisites, modules, lessons, enrollments, lessonProgress,
};
