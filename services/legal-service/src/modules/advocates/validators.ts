import { z } from "zod";

const PHONE = /^\+?[0-9][0-9 -]{6,18}[0-9]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const createAdvocateBody = z.object({
  name: z.string().trim().min(1).max(200),
  // Bar Council enrolment number, e.g. D/1234/2011 or MAH/567/2015.
  barEnrolmentNo: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9/.\- ]{2,39}$/, "enter the Bar enrolment number, e.g. D/1234/2011"),
  contact: z.string().trim().max(200).refine((v) => PHONE.test(v) || EMAIL.test(v), "contact must be a phone number or an email address"),
});
export type CreateAdvocateBody = z.infer<typeof createAdvocateBody>;

export const advocateIdParam = z.object({ id: z.string().uuid() });
