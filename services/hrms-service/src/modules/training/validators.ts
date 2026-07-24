import { z } from "zod";

export const createTrainingBody = z.object({
  title:           z.string().min(1).max(256),
  venue:           z.string().max(256).optional(),
  fromDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  facilitator:     z.string().max(256).optional(),
  maxParticipants: z.number().int().positive().default(30),
});
export type CreateTrainingBody = z.infer<typeof createTrainingBody>;

export const createNominationBody = z.object({
  trainingId: z.string().uuid(),
  employeeId: z.string().uuid(),
});
export type CreateNominationBody = z.infer<typeof createNominationBody>;

export const completeNominationBody = z.object({
  completedDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  result:         z.enum(["pass", "fail"]).default("pass"),
  score:          z.number().int().min(0).max(100).optional(),
  certificateRef: z.string().max(256).optional(),
});
export type CompleteNominationBody = z.infer<typeof completeNominationBody>;

// SVC-121/122 -- per-employee "my nominations" read query.
export const myNominationsQuery = z.object({
  employeeId: z.string().uuid(),
  limit:      z.coerce.number().int().positive().max(200).default(100),
});
export type MyNominationsQuery = z.infer<typeof myNominationsQuery>;
