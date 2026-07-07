import { z } from "zod";

export const createObligationBody = z.object({
  contractId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).default(""),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  ownerId: z.string().uuid(),
});

export type CreateObligationBody = z.infer<typeof createObligationBody>;

export const updateObligationBody = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").optional(),
  ownerId: z.string().uuid().optional(),
  status: z.enum(["pending", "in_progress", "completed", "overdue"]).optional(),
  version: z.number().int().min(1),
});

export type UpdateObligationBody = z.infer<typeof updateObligationBody>;

export const obligationIdParam = z.object({
  id: z.string().uuid(),
});

export const obligationListQuery = z.object({
  contractId: z.string().uuid().optional(),
  status: z.enum(["pending", "in_progress", "completed", "overdue"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
