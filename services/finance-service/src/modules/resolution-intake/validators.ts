/**
 * Zod validators for resolution-intake routes.
 */
import { z } from "zod";

export const intakeListQuery = z.object({
  status: z.enum(["pending_review", "accepted", "rejected"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const intakeIdParam = z.object({
  id: z.string().uuid(),
});

export const reviewBody = z.object({
  decision: z.enum(["accepted", "rejected"]),
  note: z.string().max(2000).optional(),
});

export type IntakeListQuery = z.infer<typeof intakeListQuery>;
export type ReviewBody = z.infer<typeof reviewBody>;
