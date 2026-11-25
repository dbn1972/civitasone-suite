import { z } from "zod";
import { CLOSE_OUTCOMES } from "./domain.js";

export const idParam = z.object({ id: z.string().uuid() });

export const assignBody = z.object({
  assignedTo: z.string().trim().min(1).max(128),
});
export type AssignBody = z.infer<typeof assignBody>;

export const closeBody = z.object({
  outcome: z.enum(CLOSE_OUTCOMES),
  reason:  z.string().trim().min(3, "a close reason is required").max(2000),
});
export type CloseBody = z.infer<typeof closeBody>;
