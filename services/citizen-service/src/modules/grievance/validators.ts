import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";

export const idParam = z.object({ id: z.string().uuid() });
/** P0-3: citizenId is optional in input — resolved/constrained from the actor. */
export const citizenIdQuery = z.object({ citizenId: z.string().uuid().optional() });

export const registerGrievanceBody = z.object({
  citizenId:   z.string().uuid().optional(),
  // P1-7: capped, control-char-stripped, CSV-injection-guarded free text.
  category:    safeText({ max: 64 }),
  subject:     safeText({ max: 200 }),
  description: safeText({ max: 5000, multiline: true }),
});
export type RegisterGrievanceBody = z.infer<typeof registerGrievanceBody>;

export const assignGrievanceBody = z.object({
  assignedTo:    z.string().uuid(),
  departmentRef: safeText({ max: 128 }).optional(),
});
export type AssignGrievanceBody = z.infer<typeof assignGrievanceBody>;

export const grievanceActionBody = z.object({
  actionType: safeText({ max: 64 }),
  note:       safeText({ max: 2000, multiline: true }).optional(),
  status:     z.enum(["in_progress", "resolved"]).optional(),
});
export type GrievanceActionBody = z.infer<typeof grievanceActionBody>;

export const resolveGrievanceBody = z.object({
  note: safeText({ max: 2000, multiline: true }).optional(),
});
export type ResolveGrievanceBody = z.infer<typeof resolveGrievanceBody>;

export const escalateGrievanceBody = z.object({
  reason:      safeText({ max: 1000, multiline: true }),
  escalatedTo: z.string().uuid().optional(),
});
export type EscalateGrievanceBody = z.infer<typeof escalateGrievanceBody>;

export const reopenGrievanceBody = z.object({
  reason: safeText({ max: 1000, multiline: true }),
});
export type ReopenGrievanceBody = z.infer<typeof reopenGrievanceBody>;
