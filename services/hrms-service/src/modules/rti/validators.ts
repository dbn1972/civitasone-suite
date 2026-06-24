import { z } from "zod";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const fileRtiBody = z.object({
  referenceNo:      z.string().min(1).max(64),
  applicantName:    z.string().min(1).max(256),
  applicantContact: z.string().max(256).optional(),
  subject:          z.string().min(1).max(512),
  requestText:      z.string().min(1),
  receivedDate:     DATE,
  // RTI Act 2005: PIO must respond within 30 days of receipt.
  slaDays:          z.number().int().positive().max(60).default(30),
});
export type FileRtiBody = z.infer<typeof fileRtiBody>;

export const assignPioBody = z.object({ pioId: z.string().uuid() });
export const respondRtiBody = z.object({
  responseText:  z.string().min(1),
  respondedDate: DATE,
});
export const appealRtiBody = z.object({
  appealText: z.string().min(1),
  appealDate: DATE,
});
export const closeRtiBody = z.object({ closedDate: DATE });

export const idParam = z.object({ id: z.string().uuid() });
