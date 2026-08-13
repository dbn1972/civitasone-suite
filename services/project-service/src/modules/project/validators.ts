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

export const updateProjectBody = z.object({
  name:            z.string().min(1).max(255).optional(),
  agencyRef:       z.string().optional(),
  startDate:       z.string().optional(),
  endDate:         z.string().optional(),
  sanctionedMinor: z.number().int().nonnegative().optional(),
  dprCostMinor:    z.number().int().nonnegative().optional(),
  sanctionRef:     z.string().optional(),
  status:          z.enum(["planned", "active", "on_hold", "completed", "cancelled", "archived"]).optional(),
}).strict();
export type UpdateProjectBody = z.infer<typeof updateProjectBody>;

export const updateTaskBody = z.object({
  name:          z.string().min(1).max(255).optional(),
  description:   z.string().max(1000).optional(),
  parentTaskId:  z.string().uuid().optional().nullable(),
  weightPct:     z.number().min(0).max(100).optional(),
  plannedStart:  z.string().optional(),
  plannedEnd:    z.string().optional(),
  assigneeId:    z.string().uuid().optional().nullable(),
  progressPct:   z.number().min(0).max(100).optional(),
}).strict();
export type UpdateTaskBody = z.infer<typeof updateTaskBody>;

export const addMemberBody = z.object({
  userId: z.string().uuid(),
  role:   z.enum(["project_manager", "project_officer", "engineer", "finance_officer", "viewer"]).default("viewer"),
});
export type AddMemberBody = z.infer<typeof addMemberBody>;

export const memberParam   = z.object({ id: z.string().uuid(), memberId: z.string().uuid() });
export const listTasksQuery = z.object({
  status:   z.string().optional(),
  parentId: z.string().uuid().optional(),
  limit:    z.coerce.number().int().positive().max(200).default(100),
});
