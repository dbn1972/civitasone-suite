// Shared types for the Add Employee Wizard
// Imported by AddEmployeeWizard.tsx and all step components

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
  employeeType: "permanent" | "contractual" | "deputation" | "apprentice";
  // Step 3 — Assignment
  managerId: string;
  workLocation: string;
  shift: "general" | "morning" | "evening" | "night" | "";
  costCenter: string;
  // Step 4 — Statutory
  pan: string;
  aadhaarRef: string;
  pfEnrolled: boolean;
  esiEnrolled: boolean;
  ptApplicable: boolean;
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
  managerId: "",
  workLocation: "",
  shift: "",
  costCenter: "",
  pan: "",
  aadhaarRef: "",
  pfEnrolled: true,
  esiEnrolled: false,
  ptApplicable: true,
  bankAccountNo: "",
  bankIfsc: "",
};

export const SESSION_KEY = "civitas-add-emp-draft";

// ── Shared DS tokens ─────────────────────────────────────────────────────────
export const ACCENT = "#047857";

export const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 8,
  background: "#fff",
  color: "#0f172a",
  minHeight: 44,
  outline: "none",
};

export const inputErrorStyle: React.CSSProperties = {
  ...inputStyle,
  border: "1px solid #ef4444",
  background: "#fff7f7",
};

export const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#0f172a",
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
  color: "#475569",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  minHeight: 44,
};

export const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
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
  }

  if (step === 2) {
    if (!data.employeeNo.trim()) errs.employeeNo = "Employee ID is required.";
    if (!data.departmentId) errs.departmentId = "Department is required.";
    if (!data.designationId) errs.designationId = "Designation is required.";
    if (!data.dateOfJoining) errs.dateOfJoining = "Date of Joining is required.";
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
