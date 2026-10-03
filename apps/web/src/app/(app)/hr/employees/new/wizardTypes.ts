// Shared types for the Add Employee Wizard
// Imported by AddEmployeeWizard.tsx and all step components

// GAP-HR-EMPLOYEES-NEW-02: same decimal-safe rupees->paise helper every
// other money input in this app already uses -- never Number(x)*100.
// Re-exported so step components only need to import from "../wizardTypes".
export { rupeesToMinorString } from "@/lib/money";
import { rupeesToMinorString as toMinor } from "@/lib/money";

export type WizardData = {
  // Step 1 — Personal Info
  fullName: string;
  dateOfBirth: string;
  gender: "male" | "female" | "other" | "";
  maritalStatus: "single" | "married" | "divorced" | "widowed" | "";
  bloodGroup: "A+" | "A-" | "B+" | "B-" | "O+" | "O-" | "AB+" | "AB-" | "";
  mobile: string;
  email: string;
  // Step 2 — Employment
  employeeNo: string;
  departmentId: string;
  designationId: string;
  grade: string;
  dateOfJoining: string;
  // GAP-HR-EMPLOYEES-NEW-06: widened from a 4-value closed union to a
  // plain string -- the tenant employee-types master (and the legacy
  // engagement-policy codes it accepts) can contain any code, not just
  // these four hard-coded ones (see new/steps/Step2.tsx).
  employeeType: string;
  // GAP-HR-EMPLOYEES-NEW-02: rupees, as typed (e.g. "44900.50") -- converted
  // to paise via lib/money.ts's rupeesToMinorString in buildPayload, never
  // Number(x)*100. payStructureId is intentionally not collected here yet;
  // EditEmployeeForm.tsx's EntityPicker already lets HR set it right after
  // creation, which was judged sufficient for this pass (see PR notes).
  basicPay: string;
  // Step 3 — Assignment
  managerId: string;
  workLocation: string;
  // GAP-HR-LOCATIONS-03: the picked location-master id (opaque cross-service
  // reference, never an FK). `workLocation` then carries its display name,
  // which is what the legacy `station` column stores.
  locationId: string;
  shift: "general" | "morning" | "evening" | "night" | "";
  // GAP-HR-EMPLOYEES-NEW-01: the picked finance cost-centre's id (was free text that never persisted).
  costCenterId: string;
  // Step 4 — Statutory
  pan: string;
  aadhaarRef: string;
  bankAccountNo: string;
  bankIfsc: string;
};

export type FieldErrors = Record<string, string>;

export const WIZARD_INIT: WizardData = {
  fullName: "",
  dateOfBirth: "",
  gender: "",
  maritalStatus: "",
  bloodGroup: "",
  mobile: "",
  email: "",
  employeeNo: "",
  departmentId: "",
  designationId: "",
  grade: "",
  dateOfJoining: "",
  employeeType: "permanent",
  basicPay: "",
  managerId: "",
  workLocation: "",
  locationId: "",
  shift: "",
  costCenterId: "",
  pan: "",
  aadhaarRef: "",
  bankAccountNo: "",
  bankIfsc: "",
};

export const SESSION_KEY = "civitas-add-emp-draft";

/**
 * GAP-HR-EMPLOYEES-NEW-03: statutory identifier fields that must never be
 * written to the sessionStorage draft (see AddEmployeeWizard's saveDraft /
 * restoreDraft). PAN, Aadhaar reference, and bank details are sensitive
 * financial/statutory identifiers — unlike the rest of the wizard state, the
 * user always re-enters these four rather than having them autosaved.
 * pfEnrolled / esiEnrolled / ptApplicable are plain enrollment booleans, not
 * identifiers, so they keep autosaving with everything else.
 */
export const SENSITIVE_DRAFT_FIELDS = ["pan", "aadhaarRef", "bankAccountNo", "bankIfsc"] as const;

// ── Shared DS tokens ─────────────────────────────────────────────────────────
export const ACCENT = "#047857";

export const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 8,
  background: "var(--panel, #fff)",
  color: "var(--ink, #0f172a)",
  minHeight: 44,
  outline: "none",
};

export const inputErrorStyle: React.CSSProperties = {
  ...inputStyle,
  border: "1px solid var(--bad, #ef4444)",
  background: "var(--badbg, #fff7f7)",
};

export const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink, #0f172a)",
};

export const fieldWrap: React.CSSProperties = { display: "grid", gap: 6 };

export const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: "16px 24px",
};

export const primaryBtn: React.CSSProperties = {
  padding: "10px 22px",
  background: ACCENT,
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 44,
};

export const ghostBtn: React.CSSProperties = {
  padding: "10px 22px",
  background: "transparent",
  color: "var(--ink2, #475569)",
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  minHeight: 44,
};

export const cardStyle: React.CSSProperties = {
  background: "var(--panel, #fff)",
  border: "1px solid var(--line, #e2e8f0)",
  borderRadius: 8,
  padding: 24,
};

// ── Validation ────────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^\+?[\d\s\-()]{7,15}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function validateStep(step: number, data: WizardData): FieldErrors {
  const errs: FieldErrors = {};

  if (step === 1) {
    if (!data.fullName.trim()) errs.fullName = "Full Name is required.";
    if (data.email && !EMAIL_RE.test(data.email.trim()))
      errs.email = "Enter a valid email address.";
    if (data.mobile && !MOBILE_RE.test(data.mobile.trim()))
      errs.mobile = "Enter a valid mobile number.";
    // GAP-HR-EMPLOYEES-NEW-08: the date input's `max` attribute assumes 18
    // years (Step1.tsx) but nothing enforced it here, so a typed date could
    // bypass that HTML-only guard entirely. Policy default (18, the general
    // minimum recruitment age) -- apprentices under 18 may be a legitimate
    // exception per this item's own risk note; confirm with HR before
    // tightening this further for that engagement type specifically.
    if (data.dateOfBirth) {
      const dob = new Date(data.dateOfBirth);
      if (Number.isNaN(dob.getTime()) || dob > new Date()) {
        errs.dateOfBirth = "Enter a valid date of birth.";
      } else {
        const eighteenthBirthday = new Date(dob);
        eighteenthBirthday.setFullYear(dob.getFullYear() + 18);
        if (eighteenthBirthday > new Date()) errs.dateOfBirth = "Employee must be at least 18 years old.";
      }
    }
  }

  if (step === 2) {
    if (!data.employeeNo.trim()) errs.employeeNo = "Employee ID is required.";
    if (!data.departmentId) errs.departmentId = "Department is required.";
    if (!data.designationId) errs.designationId = "Designation is required.";
    if (!data.dateOfJoining) errs.dateOfJoining = "Date of Joining is required.";
    // GAP-HR-EMPLOYEES-NEW-02: optional, but if provided must be a real
    // decimal-safe rupee amount -- not required, since basic pay may be
    // fixed later via the pay-structure assignment instead.
    if (data.basicPay.trim() && !toMinor(data.basicPay.trim())) {
      errs.basicPay = "Enter a valid amount in rupees (up to 2 decimal places).";
    }
  }

  if (step === 4) {
    if (data.pan && !PAN_RE.test(data.pan.trim()))
      errs.pan = "PAN must be in format ABCDE1234F.";
    if (data.bankIfsc && !IFSC_RE.test(data.bankIfsc.trim()))
      errs.bankIfsc = "IFSC must be in format SBIN0001234.";
  }

  return errs;
}

export function validateField(field: keyof WizardData, data: WizardData): string {
  const allErrs = validateStep(1, data);
  const allErrs2 = validateStep(2, data);
  const allErrs4 = validateStep(4, data);
  const combined = { ...allErrs, ...allErrs2, ...allErrs4 };
  return combined[field as string] ?? "";
}
