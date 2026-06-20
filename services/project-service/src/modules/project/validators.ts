import { z } from "zod";

export const createProjectBody = z.object({
  code:             z.string().min(1).max(64),
  name:             z.string().min(1).max(255),
  schemeId:         z.string().uuid().optional(),
  agencyRef:        z.string().optional(),
  dprCostMinor:     z.number().int().nonnegative().default(0),
  sanctionedMinor:  z.number().int().nonnegative().default(0),
  sanctionRef:      z.string().optional(),
  startDate:        z.string().optional(),
  endDate:          z.string().optional(),
});
export type CreateProjectBody = z.infer<typeof createProjectBody>;

export const createTaskBody = z.object({
  name:          z.string().min(1).max(255),
  description:   z.string().max(1000).optional(),
  parentTaskId:  z.string().uuid().optional(),
  weightPct:     z.number().min(0).max(100).default(0),
  plannedStart:  z.string().optional(),
  plannedEnd:    z.string().optional(),
});
export type CreateTaskBody = z.infer<typeof createTaskBody>;

export const updateTaskStatusBody = z.object({
  status:     z.enum(["pending", "in_progress", "completed", "blocked"]),
  progressPct: z.number().min(0).max(100).optional(),
});
export type UpdateTaskStatusBody = z.infer<typeof updateTaskStatusBody>;

export const createMilestoneBody = z.object({
  name:          z.string().min(1).max(255),
  plannedDate:   z.string().min(1),
  paymentMinor:  z.number().int().nonnegative().default(0),
});
export type CreateMilestoneBody = z.infer<typeof createMilestoneBody>;

export const idParam     = z.object({ id: z.string().uuid() });
export const taskParam   = z.object({ id: z.string().uuid(), taskId: z.string().uuid() });
export const milestoneParam = z.object({ id: z.string().uuid(), mId: z.string().uuid() });

export const listProjectsQuery = z.object({
  tenantId: z.string().uuid().optional(),
  status:   z.string().optional(),
  page:     z.coerce.number().int().positive().default(1),
  limit:    z.coerce.number().int().positive().max(100).default(20),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuery>;
