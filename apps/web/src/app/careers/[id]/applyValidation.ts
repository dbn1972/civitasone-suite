import { rupeesToMinorString } from "@/lib/money";

/**
 * Client-side mirror of the backend `publicApplicationBody` rules
 * (services/hrms-service validators.ts), deliberately NO stricter than the
 * server so a form the server would accept is never blocked here
 * (GAP-RECRUITMENT-CAREERS-DETAIL-05 / -10, DPDP consent -02).
 *
 * Error keys are the backend's field names, so the server's `fieldErrors`
 * and these local ones address the same inputs.
 */
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
};

export type ApplyErrors = Partial<Record<
  "applicantName" | "email" | "mobile" | "experienceYears" | "graduationYear" | "stipendExpectedMinor" | "availabilityHoursPerWeek" | "consent",
  string
>>;

/** Backend field -> input id, in on-screen order (used to focus the first invalid input). */
export const FIELD_IDS: Record<string, string> = {
  applicantName: "apply-name",
  email: "apply-email",
  mobile: "apply-mobile",
  qualification: "apply-qual",
  experienceYears: "apply-exp",
  skills: "apply-skills",
  institutionName: "apply-inst",
  semester: "apply-sem",
  graduationYear: "apply-gradyr",
  stipendExpectedMinor: "apply-stipend",
  tradeCategory: "apply-trade",
  itiCertNo: "apply-iti",
  availabilityHoursPerWeek: "apply-hrs",
  consent: "apply-consent",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INT_RE = /^\d+$/;

/** Rupees (as typed) -> paise number for the request body, or an error message. Never uses float math. */
export function stipendToMinor(input: string): { ok: true; minor: number } | { ok: false; message: string } {
  const minor = rupeesToMinorString(input, { allowZero: true });
  if (minor === null) {
    return { ok: false, message: /^\d+\.\d{3,}$/.test(input.trim()) ? "Enter up to 2 decimal places." : "Enter a valid amount in rupees, for example 15000 or 15000.50." };
  }
  // Keep within what a JSON number carries exactly (and what the API's int accepts).
  if (minor.length > 15) return { ok: false, message: "That amount is too large." };
  return { ok: true, minor: Number(minor) };
}

export function validateApply(v: ApplyValues): ApplyErrors {
  const e: ApplyErrors = {};
  const name = v.name.trim();
  if (!name) e.applicantName = "Enter your full name.";
  else if (name.length < 2) e.applicantName = "Your name must be at least 2 characters.";

  const email = v.email.trim();
  if (!email) e.email = "Enter your email address.";
  else if (!EMAIL_RE.test(email)) e.email = "Enter a valid email address, for example name@example.com.";

  const mobile = v.mobile.trim();
  if (mobile) {
    const digits = mobile.replace(/\D/g, "");
    if (mobile.length > 20 || digits.length < 10 || !/^\+?[\d\s-]+$/.test(mobile)) {
      e.mobile = "Enter a valid mobile number with at least 10 digits.";
    }
  }

  if (v.experience.trim() && !(INT_RE.test(v.experience.trim()) && Number.isSafeInteger(Number(v.experience)))) {
    e.experienceYears = "Enter whole years of experience, for example 2.";
  }

  if (v.vacancyType === "internship") {
    const g = v.graduationYear.trim();
    if (g && !(INT_RE.test(g) && Number(g) >= 1990 && Number(g) <= 2040)) {
      e.graduationYear = "Enter a graduation year between 1990 and 2040.";
    }
    const s = v.stipendExpected.trim();
    if (s) {
      const r = stipendToMinor(s);
      if (!r.ok) e.stipendExpectedMinor = r.message;
    }
  }
  if (v.vacancyType === "volunteership") {
    const h = v.availabilityHours.trim();
    if (h && !(INT_RE.test(h) && Number(h) >= 1 && Number(h) <= 168)) {
      e.availabilityHoursPerWeek = "Enter whole hours per week between 1 and 168.";
    }
  }

  if (!v.consent) e.consent = "You must accept the privacy notice to apply.";
  return e;
}

/** First field (on-screen order) that carries an error, as an input id. */
export function firstInvalidId(errors: Record<string, string | undefined>): string | undefined {
  for (const [field, id] of Object.entries(FIELD_IDS)) {
    if (errors[field]) return id;
  }
  return undefined;
}
