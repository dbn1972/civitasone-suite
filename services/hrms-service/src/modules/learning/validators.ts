import { z } from "zod";

export const createCourseBody = z.object({
  code:        z.string().min(1).max(32),
  title:       z.string().min(1).max(256),
  description: z.string().max(4000).optional(),
  category:    z.string().max(64).default("general"),
  creditHours: z.number().min(0).max(1000).default(0),
});
export type CreateCourseBody = z.infer<typeof createCourseBody>;

export const createModuleBody = z.object({
  title:    z.string().min(1).max(256),
  sequence: z.number().int().min(1).max(1000).default(1),
});
export type CreateModuleBody = z.infer<typeof createModuleBody>;

export const createLessonBody = z.object({
  title:        z.string().min(1).max(256),
  sequence:     z.number().int().min(1).max(1000).default(1),
  contentType:  z.enum(["scorm", "xapi", "video", "pdf", "link"]),
  contentUri:   z.string().max(2048).optional(),
  durationMins: z.number().int().min(0).max(100000).default(0),
});
export type CreateLessonBody = z.infer<typeof createLessonBody>;

export const addPrerequisiteBody = z.object({
  prerequisiteCourseId: z.string().uuid(),
});
export type AddPrerequisiteBody = z.infer<typeof addPrerequisiteBody>;

export const enrollBody = z.object({
  employeeId: z.string().uuid(),
});
export type EnrollBody = z.infer<typeof enrollBody>;

export const lessonProgressBody = z.object({
  employeeId: z.string().uuid(),
  status:     z.enum(["in_progress", "completed"]).default("completed"),
});
export type LessonProgressBody = z.infer<typeof lessonProgressBody>;
