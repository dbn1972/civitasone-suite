import { z } from "zod";

export const VACANCY_TYPES = ["regular", "internship", "apprenticeship", "contractual", "deputation"] as const;
export type VacancyType = typeof VACANCY_TYPES[number];

export const createJobOpeningBody = z.object({
  refNo:         z.string().min(1).max(64),
  title:         z.string().min(1).max(256),
  departmentId:  z.string().uuid(),
  designationId: z.string().uuid().optional(),
  vacancies:     z.number().int().positive().default(1),
  description:   z.string().max(5000).optional(),
  vacancyType:   z.enum(VACANCY_TYPES).default("regular"),
  location:      z.string().max(200).optional(),
  qualification: z.string().max(500).optional(),
  payRange:      z.string().max(120).optional(),
  isPublished:   z.boolean().default(false),
  postedAt:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  closesAt:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type CreateJobOpeningBody = z.infer<typeof createJobOpeningBody>;

export const createApplicationBody = z.object({
  jobOpeningId:    z.string().uuid(),
  applicantName:   z.string().min(1).max(256),
  email:           z.string().email().optional(),
  mobile:          z.string().max(20).optional(),
  resumeRef:       z.string().optional(),
  qualification:   z.string().max(500).optional(),
  experienceYears: z.number().int().nonnegative().optional(),
  skills:          z.array(z.string().max(64)).max(20).optional(),
});
export type CreateApplicationBody = z.infer<typeof createApplicationBody>;

/** Public application — no auth required; source = "public_portal". */
export const publicApplicationBody = z.object({
  jobOpeningId:    z.string().uuid(),
  applicantName:   z.string().min(2, "Your name is required").max(256),
  email:           z.string().email("Please enter a valid email"),
  mobile:          z.string().min(10, "Please enter a valid mobile number").max(20).optional(),
  qualification:   z.string().max(500).optional(),
  experienceYears: z.number().int().nonnegative().optional(),
  skills:          z.array(z.string().max(64)).max(20).optional(),
});
export type PublicApplicationBody = z.infer<typeof publicApplicationBody>;

export const offerApplicationBody = z.object({
  ctcMinor:    z.number().int().positive(),
  currency:    z.string().length(3).default("INR"),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type OfferApplicationBody = z.infer<typeof offerApplicationBody>;

export const hireApplicationBody = z.object({
  employeeNo:    z.string().min(1).max(32),
  dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  basicMinor:    z.number().int().nonnegative(),
  departmentId:  z.string().uuid(),
  designationId: z.string().uuid(),
  // Any code; membership enforced at the hire route via assertKnownEngagementType
  // so the 5 DIC engagement types (consultant/third_party/apprentice/…) and
  // tenant-defined type codes can be recruited (was a 4-value enum).
  employeeType:  z.string().min(1).max(32).default("permanent"),
});
export type HireApplicationBody = z.infer<typeof hireApplicationBody>;

export const idParam = z.object({ id: z.string().uuid() });
