import { CAREERS_CONSENT_ACCEPTED_VERSIONS } from "@civitasone/schemas";
import { z } from "zod";

export const VACANCY_TYPES = ["regular", "internship", "apprenticeship", "volunteership", "contractual", "deputation"] as const;
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
  // GAP-RECRUITMENT-NEW-02: structured pay. Min/max are bigint PAISE carried as decimal strings
  // (never JS numbers); payRange stays the display text.
  payLevel:      z.string().trim().min(1).max(16).optional(),
  payMinMinor:   z.string().regex(/^\d{1,15}$/).optional(),
  payMaxMinor:   z.string().regex(/^\d{1,15}$/).optional(),
  isPublished:   z.boolean().default(false),
  postedAt:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  closesAt:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // MEDIUM finding: JD-template linkage. templateId records which template
  // (if any) this opening was created from, so jd-template-repo's useCount/
  // traceability actually works regardless of which create path was used
  // (this direct route, or jd-template-routes.ts's POST .../use). The other
  // three mirror createJdTemplateBody's own field shapes/limits (validators.ts
  // above) since they carry the SAME data through from a template.
  templateId:        z.string().uuid().optional(),
  selectionProcess:  z.string().max(3000).optional(),
  requiredDocuments: z.array(z.string().max(200)).max(30).optional(),
  eligibility:       z.record(z.unknown()).optional(),
}).refine(
  (b) => b.payMinMinor === undefined || b.payMaxMinor === undefined || BigInt(b.payMinMinor) <= BigInt(b.payMaxMinor),
  { message: "payMinMinor must not exceed payMaxMinor", path: ["payMinMinor"] },
);
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

/**
 * Self-declared reservation category on the public apply form (GAP-RECRUITMENT-CAREERS-DETAIL-03).
 * Stored lower-case, which is what the HR reservation card compares against. It is a CLAIM: nothing
 * is exempted or allocated on it until HR verifies the certificate (the fee assessment already
 * requires categoryVerified). Horizontal groups (PwBD / ex-servicemen) are not vertical categories
 * and are recorded by HR on the candidate profile, so they are not offered here.
 */
export const SELF_DECLARED_CATEGORIES = ["ur", "sc", "st", "obc", "ews"] as const;
const selfDeclaredCategory = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.enum(SELF_DECLARED_CATEGORIES, { errorMap: () => ({ message: "Choose one of General, SC, ST, OBC or EWS" }) }),
);

/** ISO calendar date in the past (a future date of birth is rejected). */
export const pastIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD").refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return false;
  return v >= "1900-01-01" && v < new Date().toISOString().slice(0, 10);
}, "Date of birth must be a real date in the past");

/** Public application — no auth required; source = "public_portal". */
export const publicApplicationBody = z.object({
  jobOpeningId:    z.string().uuid(),
  applicantName:   z.string().min(2, "Your name is required").max(256),
  email:           z.string().email("Please enter a valid email"),
  mobile:          z.string().min(10, "Please enter a valid mobile number").max(20).optional(),
  qualification:   z.string().max(500).optional(),
  experienceYears: z.number().int().nonnegative().optional(),
  skills:          z.array(z.string().max(64)).max(20).optional(),
  category:        selfDeclaredCategory.optional(),
  dateOfBirth:     pastIsoDate.optional(),
  // Key returned by POST /v1/careers/resume; the route checks it belongs to this tenant's namespace.
  resumeKey:       z.string().min(1).max(300).optional(),
  // Internship-specific
  institutionName:          z.string().max(200).optional(),
  graduationYear:           z.number().int().min(1990).max(2040).optional(),
  semester:                 z.string().max(20).optional(),
  stipendExpectedMinor:     z.number().int().nonnegative().optional(),
  // Apprenticeship-specific
  tradeCategory:            z.string().max(100).optional(),
  itiCertNo:                z.string().max(80).optional(),
  // Volunteership-specific
  availabilityHoursPerWeek: z.number().int().min(1).max(168).optional(),
  // DPDP: the candidate must explicitly accept the privacy notice; the version
  // names the notice text shown so the consent is auditable.
  consent:        z.literal(true, { errorMap: () => ({ message: "You must accept the privacy notice to apply" }) }),
  consentVersion: z.string().min(1, "Consent version is required").max(32)
    .refine((v) => CAREERS_CONSENT_ACCEPTED_VERSIONS.includes(v), "Unknown privacy notice version"),
});
export type PublicApplicationBody = z.infer<typeof publicApplicationBody>;

export const createJdTemplateBody = z.object({
  name:             z.string().min(1).max(200),
  vacancyType:      z.enum(VACANCY_TYPES).default("regular"),
  description:      z.string().max(5000).optional(),
  qualification:    z.string().max(500).optional(),
  payRange:         z.string().max(120).optional(),
  selectionProcess: z.string().max(3000).optional(),
  requiredDocuments: z.array(z.string().max(200)).max(30).optional(),
  eligibility:      z.record(z.unknown()).optional(),
  tags:             z.array(z.string().max(60)).max(10).optional(),
});
export type CreateJdTemplateBody = z.infer<typeof createJdTemplateBody>;

export const updateJdTemplateBody = createJdTemplateBody.partial();
export type UpdateJdTemplateBody = z.infer<typeof updateJdTemplateBody>;

export const offerApplicationBody = z.object({
  ctcMinor:    z.number().int().positive(),
  currency:    z.string().length(3).default("INR"),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type OfferApplicationBody = z.infer<typeof offerApplicationBody>;

export const hireApplicationBody = z.object({
  employeeNo:    z.string().min(1).max(32),
  dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Recruitment hardening: a genuinely positive basic pay is required for a
  // real hire -- nonnegative() let a ₹0 basic through.
  basicMinor:    z.number().int().positive(),
  departmentId:  z.string().uuid(),
  designationId: z.string().uuid(),
  // Any code; membership enforced at the hire route via assertKnownEngagementType
  // so the 5 DIC engagement types (consultant/third_party/apprentice/…) and
  // tenant-defined type codes can be recruited (was a 4-value enum).
  employeeType:  z.string().min(1).max(32).default("permanent"),
});
export type HireApplicationBody = z.infer<typeof hireApplicationBody>;

export const idParam = z.object({ id: z.string().uuid() });
