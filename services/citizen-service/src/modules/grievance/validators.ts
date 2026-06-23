import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });
export const citizenIdQuery = z.object({ citizenId: z.string().uuid() });

export const registerGrievanceBody = z.object({
  citizenId:   z.string().uuid(),
  category:    z.string().min(1),
  subject:     z.string().min(1),
  description: z.string().min(1),
});
export type RegisterGrievanceBody = z.infer<typeof registerGrievanceBody>;

export const assignGrievanceBody = z.object({
  assignedTo:    z.string().uuid(),
  departmentRef: z.string().optional(),
});
export type AssignGrievanceBody = z.infer<typeof assignGrievanceBody>;

export const grievanceActionBody = z.object({
  actionType: z.string().min(1),
  note:       z.string().optional(),
  status:     z.enum(["in_progress", "resolved"]).optional(),
});
export type GrievanceActionBody = z.infer<typeof grievanceActionBody>;

export const resolveGrievanceBody = z.object({
  note: z.string().optional(),
});
export type ResolveGrievanceBody = z.infer<typeof resolveGrievanceBody>;

export const escalateGrievanceBody = z.object({
  reason:      z.string().min(1),
  escalatedTo: z.string().uuid().optional(),
});
export type EscalateGrievanceBody = z.infer<typeof escalateGrievanceBody>;

export const reopenGrievanceBody = z.object({
  reason: z.string().min(1),
});
export type ReopenGrievanceBody = z.infer<typeof reopenGrievanceBody>;
