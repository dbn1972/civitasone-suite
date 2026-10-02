/**
 * Recruitment enums mirrored from hrms-service (no shared package exposes them
 * to the web app). Keep in sync with:
 *   - VACANCY_TYPES          services/hrms-service/src/modules/recruitment/validators.ts
 *   - REJECTION_REASON_CODES services/hrms-service/src/modules/recruitment/screening.ts
 */
import { z } from "zod";
import { rupeesToMinorString } from "@/lib/money";

export const VACANCY_TYPES = ["regular", "internship", "apprenticeship", "volunteership", "contractual", "deputation"] as const;
export type VacancyType = (typeof VACANCY_TYPES)[number];

export function isVacancyType(v: unknown): v is VacancyType {
  return typeof v === "string" && (VACANCY_TYPES as readonly string[]).includes(v);
}

export const REJECTION_REASON_CODES = [
  "eligibility", "skill", "experience", "qualification",
  "incomplete_documents", "duplicate", "position_hold", "other",
] as const;
export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

// --- New job opening form validation (GAP-RECRUITMENT-NEW-02/03/04/05) ---------------------------------
// Mirrors createJobOpeningBody in services/hrms-service/src/modules/recruitment/validators.ts. There is
// no shared package, so keep the limits below in sync with that file. Every failing field is reported at
// once (not first-error-wins) so the form can list them all and focus the first.

export const JOB_OPENING_LIMITS = {
  refNo: 64,
  title: 256,
  description: 5000,
  qualification: 500,
  payRange: 120,
  selectionProcess: 3000,
  location: 200,
  payLevel: 16,
  requiredDocuments: 30,
  requiredDocumentLength: 200,
} as const;

export type JobOpeningFormValues = {
  refNo: string;
  title: string;
  departmentId: string;
  designationId: string;
  vacancies: number;
  description: string;
  qualification: string;
  payRange: string;
  payLevel: string;
  /** Rupees as typed (a plain decimal); converted to paise only when validated/sent. */
  payMinRupees: string;
  payMaxRupees: string;
  selectionProcess: string;
  location: string;
  postedAt: string;
  closesAt: string;
  requiredDocuments: string[];
};

export type JobOpeningField = Exclude<keyof JobOpeningFormValues, "vacancies"> | "vacancies";
export type JobOpeningErrorCode =
  | "refNoRequired" | "titleRequired" | "departmentRequired" | "vacanciesMin"
  | "tooLong" | "invalidDate" | "invalidAmount" | "minGreaterThanMax" | "tooManyDocuments" | "documentTooLong" | "invalidId";
export type JobOpeningFieldError = { code: JobOpeningErrorCode; max?: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().refine((v) => v === "" || DATE_RE.test(v), { message: "invalidDate" });
const maxLen = (n: number) => z.string().max(n, { message: `tooLong:${n}` });

const jobOpeningFormSchema = z.object({
  refNo: z.string().trim().min(1, { message: "refNoRequired" }).max(JOB_OPENING_LIMITS.refNo, { message: `tooLong:${JOB_OPENING_LIMITS.refNo}` }),
  title: z.string().trim().min(1, { message: "titleRequired" }).max(JOB_OPENING_LIMITS.title, { message: `tooLong:${JOB_OPENING_LIMITS.title}` }),
  departmentId: z.string().trim().uuid({ message: "departmentRequired" }),
  designationId: z.string().trim().refine((v) => v === "" || z.string().uuid().safeParse(v).success, { message: "invalidId" }),
  vacancies: z.number({ invalid_type_error: "vacanciesMin" }).int({ message: "vacanciesMin" }).min(1, { message: "vacanciesMin" }),
  description: maxLen(JOB_OPENING_LIMITS.description),
  qualification: maxLen(JOB_OPENING_LIMITS.qualification),
  payRange: maxLen(JOB_OPENING_LIMITS.payRange),
  payLevel: maxLen(JOB_OPENING_LIMITS.payLevel),
  payMinRupees: z.string(),
  payMaxRupees: z.string(),
  selectionProcess: maxLen(JOB_OPENING_LIMITS.selectionProcess),
  location: maxLen(JOB_OPENING_LIMITS.location),
  postedAt: isoDate,
  closesAt: isoDate,
  requiredDocuments: z.array(z.string().max(JOB_OPENING_LIMITS.requiredDocumentLength, { message: `documentTooLong:${JOB_OPENING_LIMITS.requiredDocumentLength}` }))
    .max(JOB_OPENING_LIMITS.requiredDocuments, { message: `tooManyDocuments:${JOB_OPENING_LIMITS.requiredDocuments}` }),
});

function toFieldError(message: string): JobOpeningFieldError {
  const [code, max] = message.split(":");
  return { code: code as JobOpeningErrorCode, ...(max ? { max: Number(max) } : {}) };
}

/** Pay min/max in paise as decimal strings (undefined when blank); `null` marks an unparsable amount. */
export function payMinorFromRupees(rupees: string): string | undefined | null {
  if (!rupees.trim()) return undefined;
  return rupeesToMinorString(rupees);
}

/** All failing fields at once, keyed by field. An empty object means the form is valid. */
export function validateJobOpeningForm(values: JobOpeningFormValues): Partial<Record<JobOpeningField, JobOpeningFieldError>> {
  const errors: Partial<Record<JobOpeningField, JobOpeningFieldError>> = {};
  const parsed = jobOpeningFormSchema.safeParse(values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as JobOpeningField | undefined;
      if (field && !errors[field]) errors[field] = toFieldError(issue.message);
    }
  }
  const min = payMinorFromRupees(values.payMinRupees);
  const max = payMinorFromRupees(values.payMaxRupees);
  if (min === null && !errors.payMinRupees) errors.payMinRupees = { code: "invalidAmount" };
  if (max === null && !errors.payMaxRupees) errors.payMaxRupees = { code: "invalidAmount" };
  if (typeof min === "string" && typeof max === "string" && BigInt(min) > BigInt(max) && !errors.payMinRupees) {
    errors.payMinRupees = { code: "minGreaterThanMax" };
  }
  return errors;
}

/** First failing field, in on-screen order, so the form can focus it. */
export const JOB_OPENING_FIELD_ORDER: JobOpeningField[] = [
  "refNo", "title", "departmentId", "designationId", "vacancies", "location", "postedAt", "closesAt",
  "description", "qualification", "payLevel", "payMinRupees", "payMaxRupees", "payRange", "selectionProcess", "requiredDocuments",
];
