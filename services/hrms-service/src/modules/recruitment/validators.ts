import { z } from "zod";

export const createJobOpeningBody = z.object({
  refNo:         z.string().min(1).max(64),
  title:         z.string().min(1).max(256),
  departmentId:  z.string().uuid(),
  designationId: z.string().uuid().optional(),
  vacancies:     z.number().int().positive().default(1),
  description:   z.string().max(5000).optional(),
  postedAt:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  closesAt:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type CreateJobOpeningBody = z.infer<typeof createJobOpeningBody>;

export const createApplicationBody = z.object({
  jobOpeningId:  z.string().uuid(),
  applicantName: z.string().min(1).max(256),
  email:         z.string().email().optional(),
  mobile:        z.string().max(20).optional(),
  resumeRef:     z.string().optional(),
});
export type CreateApplicationBody = z.infer<typeof createApplicationBody>;

export const offerApplicationBody = z.object({
  ctcMinor:    z.number().int().positive(),
  currency:    z.string().length(3).default("INR"),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type OfferApplicationBody = z.infer<typeof offerApplicationBody>;

export const idParam = z.object({ id: z.string().uuid() });
