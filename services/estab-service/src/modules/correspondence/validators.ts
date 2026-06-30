import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const pucParam = z.object({
  id: z.string().uuid(),
  correspondenceId: z.string().uuid(),
});

export const addCorrespondenceBody = z.object({
  direction:    z.enum(["incoming", "outgoing"]),
  party:        z.string().min(1),
  subject:      z.string().min(1),
  letterRef:    z.string().optional(),
  letterDate:   z.string().optional(),       // ISO date (YYYY-MM-DD)
  numPages:     z.number().int().positive().default(1),
  storageRef:   z.string().optional(),
  isOfficeCopy: z.boolean().default(false),
});
export type AddCorrespondenceBody = z.infer<typeof addCorrespondenceBody>;

export const markPucBody = z.object({
  correspondenceId: z.string().uuid(),
});
export type MarkPucBody = z.infer<typeof markPucBody>;
