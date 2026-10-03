import { rupeesToMinorString } from "@/lib/money";

/**
 * Client-side mirror of the backend `publicApplicationBody` rules
 * (services/hrms-service validators.ts), deliberately NO stricter than the
 * server so a form the server would accept is never blocked here
 * (GAP-RECRUITMENT-CAREERS-DETAIL-05 / -10, DPDP consent -02).
 *
 * Error keys are the backend's field names, so the server's `fieldErrors`
 * and these local ones address the same inputs. Messages come from a resolver so the form can
 * localise them (GAP-RECRUITMENT-CAREERS-HOME-07); the default resolver is English.
 */
export type ApplyResume = { name: string; size: number; type: string } | null;

export type ApplyValues = {
  vacancyType: string;
  name: string;
  email: string;
  mobile: string;
  experience: string;
  graduationYear: string;
  stipendExpected: string;
  availabilityHours: string;
  consent: boolean;
  /** Self-declared reservation category; "" = not stated. */
  category?: string;
  /** YYYY-MM-DD, "" = not stated. */
  dateOfBirth?: string;
  resume?: ApplyResume;
  /** Today's date (YYYY-MM-DD, IST) -- injectable for tests. */
  today?: string;
};

export type ApplyErrors = Partial<Record<
  "applicantName" | "email" | "mobile" | "experienceYears" | "graduationYear" | "stipendExpectedMinor" | "availabilityHoursPerWeek" | "consent"
  | "category" | "dateOfBirth" | "resume",
  string
>>;

/** Backend field -> input id, in on-screen order (used to focus the first invalid input). */
export const FIELD_IDS: Record<string, string> = {
  applicantName: "apply-name",
  email: "apply-email",
  mobile: "apply-mobile",
  dateOfBirth: "apply-dob",
  category: "apply-category",
  qualification: "apply-qual-detail",
  experienceYears: "apply-exp",
  skills: "apply-skills",
  resume: "apply-resume",
  institutionName: "apply-inst",
  semester: "apply-sem",
  graduationYear: "apply-gradyr",
  stipendExpectedMinor: "apply-stipend",
  tradeCategory: "apply-trade",
  itiCertNo: "apply-iti",
  availabilityHoursPerWeek: "apply-hrs",
  consent: "apply-consent",
};

/** Self-declared categories the service accepts (validators.ts SELF_DECLARED_CATEGORIES). */
export const CATEGORY_VALUES = ["ur", "sc", "st", "obc", "ews"] as const;

/** Resume limits, matching the service (careers-resume.ts): PDF / DOC / DOCX, 5 MB. */
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const RESUME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};
export const RESUME_ACCEPT = ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type ApplyMessageKey =
  | "nameRequired" | "nameShort" | "emailRequired" | "emailInvalid" | "mobileInvalid" | "experienceInvalid"
  | "graduationYearInvalid" | "hoursInvalid" | "consentRequired" | "stipendDecimals" | "stipendInvalid" | "stipendTooLarge"
  | "dobInvalid" | "categoryInvalid" | "resumeType" | "resumeSize" | "resumeEmpty";
export type ApplyMessages = (key: ApplyMessageKey) => string;

const EN: Record<ApplyMessageKey, string> = {
  nameRequired: "Enter your full name.",
  nameShort: "Your name must be at least 2 characters.",
  emailRequired: "Enter your email address.",
  emailInvalid: "Enter a valid email address, for example name@example.com.",
  mobileInvalid: "Enter a valid mobile number with at least 10 digits.",
  experienceInvalid: "Enter whole years of experience, for example 2.",
  graduationYearInvalid: "Enter a graduation year between 1990 and 2040.",
  hoursInvalid: "Enter whole hours per week between 1 and 168.",
  consentRequired: "You must accept the privacy notice to apply.",
  stipendDecimals: "Enter up to 2 decimal places.",
  stipendInvalid: "Enter a valid amount in rupees, for example 15000 or 15000.50.",
  stipendTooLarge: "That amount is too large.",
  dobInvalid: "Enter your date of birth as a real date in the past.",
  categoryInvalid: "Choose one of the listed categories, or leave it blank.",
  resumeType: "Upload a PDF, DOC or DOCX file.",
  resumeSize: "The file is larger than 5 MB. Choose a smaller file.",
  resumeEmpty: "The file is empty.",
};
export const englishMessages: ApplyMessages = (key) => EN[key];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INT_RE = /^\d+$/;

/** Rupees (as typed) -> paise number for the request body, or an error message. Never uses float math. */
export function stipendToMinor(input: string, msg: ApplyMessages = englishMessages): { ok: true; minor: number } | { ok: false; message: string } {
  const minor = rupeesToMinorString(input, { allowZero: true });
  if (minor === null) {
    return { ok: false, message: /^\d+\.\d{3,}$/.test(input.trim()) ? msg("stipendDecimals") : msg("stipendInvalid") };
  }
  // Keep within what a JSON number carries exactly (and what the API's int accepts).
  if (minor.length > 15) return { ok: false, message: msg("stipendTooLarge") };
  return { ok: true, minor: Number(minor) };
}

/** A real calendar date strictly in the past (the service rejects anything else). */
export function isPastIsoDate(v: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return false;
  return v >= "1900-01-01" && v < today;
}

export function validateResume(file: NonNullable<ApplyResume>, msg: ApplyMessages = englishMessages): string | null {
  if (!(file.type in RESUME_TYPES)) return msg("resumeType");
  if (file.size <= 0) return msg("resumeEmpty");
  if (file.size > RESUME_MAX_BYTES) return msg("resumeSize");
  return null;
}

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function validateApply(v: ApplyValues, msg: ApplyMessages = englishMessages): ApplyErrors {
  const e: ApplyErrors = {};
  const name = v.name.trim();
  if (!name) e.applicantName = msg("nameRequired");
  else if (name.length < 2) e.applicantName = msg("nameShort");

  const email = v.email.trim();
  if (!email) e.email = msg("emailRequired");
  else if (!EMAIL_RE.test(email)) e.email = msg("emailInvalid");

  const mobile = v.mobile.trim();
  if (mobile) {
    const digits = mobile.replace(/\D/g, "");
    if (mobile.length > 20 || digits.length < 10 || !/^\+?[\d\s-]+$/.test(mobile)) {
      e.mobile = msg("mobileInvalid");
    }
  }

  if (v.experience.trim() && !(INT_RE.test(v.experience.trim()) && Number.isSafeInteger(Number(v.experience)))) {
    e.experienceYears = msg("experienceInvalid");
  }

  if (v.category && !(CATEGORY_VALUES as readonly string[]).includes(v.category)) e.category = msg("categoryInvalid");
  if (v.dateOfBirth && !isPastIsoDate(v.dateOfBirth, v.today ?? istToday())) e.dateOfBirth = msg("dobInvalid");
  if (v.resume) {
    const r = validateResume(v.resume, msg);
    if (r) e.resume = r;
  }

  if (v.vacancyType === "internship") {
    const g = v.graduationYear.trim();
    if (g && !(INT_RE.test(g) && Number(g) >= 1990 && Number(g) <= 2040)) {
      e.graduationYear = msg("graduationYearInvalid");
    }
    const s = v.stipendExpected.trim();
    if (s) {
      const r = stipendToMinor(s, msg);
      if (!r.ok) e.stipendExpectedMinor = r.message;
    }
  }
  if (v.vacancyType === "volunteership") {
    const h = v.availabilityHours.trim();
    if (h && !(INT_RE.test(h) && Number(h) >= 1 && Number(h) <= 168)) {
      e.availabilityHoursPerWeek = msg("hoursInvalid");
    }
  }

  if (!v.consent) e.consent = msg("consentRequired");
  return e;
}

/** First field (on-screen order) that carries an error, as an input id. */
export function firstInvalidId(errors: Record<string, string | undefined>): string | undefined {
  for (const [field, id] of Object.entries(FIELD_IDS)) {
    if (errors[field]) return id;
  }
  return undefined;
}

/** Stable English tokens stored in the application's free-text `qualification` ("Graduate — B.Com (Hons), State University"). */
export const QUALIFICATION_LEVELS = ["10th", "12th", "ITI", "Diploma", "Graduate", "Post-graduate", "Doctorate", "Other"] as const;

export function composeQualification(level: string, detail: string): string | undefined {
  const parts = [level.trim(), detail.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ").slice(0, 500) : undefined;
}
