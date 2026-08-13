import { z } from "zod";

export const createDakBody = z.object({
  subject:    z.string().min(1).max(500),
  body:       z.string().max(5000).optional(),
  fileId:     z.string().uuid().optional(),
  priority:   z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  assignedTo: z.string().uuid().optional(),
  dueDate:    z.string().datetime({ offset: true }).optional(),
});
export type CreateDakBody = z.infer<typeof createDakBody>;

export const forwardDakBody = z.object({
  assignedTo: z.string().uuid(),
  remarks:    z.string().max(2000).optional(),
});

export const createNotingBody = z.object({
  body: z.string().min(1).max(5000),
});

export const approvalDecisionBody = z.object({
  decision: z.enum(["approved", "returned", "rejected"]),
  remarks:  z.string().max(2000).optional(),
});
