"use client";

import type { WizardData } from "../wizardTypes";
import { ACCENT } from "../wizardTypes";

type Dept = { id: string; name: string };
type Desig = { id: string; name: string };

interface Props {
  data: WizardData;
  departments: Dept[];
  designations: Desig[];
  submitting: boolean;
  onGoToStep: (step: number) => void;
}

const ROW: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  padding: "8px 0",
  borderBottom: "1px solid #f1f5f9",
  gap: 8,
};

const LABEL: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  minWidth: 160,
  flexShrink: 0,
};

const VALUE: React.CSSProperties = {
  fontSize: 13,
  color: "#0f172a",
  fontWeight: 500,
  textAlign: "right",
  wordBreak: "break-all",
};

const SECTION: React.CSSProperties = {
  marginBottom: 24,
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: "16px 20px",
};

const SECTION_HDR: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 12,
};

function EditLink({ step, onGoToStep }: { step: number; onGoToStep: (s: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onGoToStep(step)}
      style={{
        background: "none",
        border: "none",
        color: ACCENT,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        textDecoration: "underline",
        padding: 0,
      }}
    >
      Edit
    </button>
  );
}

function Row({ label, value, masked }: { label: string; value?: string | boolean; masked?: boolean }) {
  const displayValue =
    typeof value === "boolean"
      ? value ? "Yes" : "No"
      : masked && value
        ? "••••••••"
        : value || "—";

  return (
    <div style={ROW}>
      <span style={LABEL}>{label}</span>
      <span style={VALUE}>{displayValue}</span>
    </div>
  );
}

function SectionHeader({ title, step, onGoToStep }: { title: string; step: number; onGoToStep: (s: number) => void }) {
  return (
    <div style={SECTION_HDR}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#374151" }}>{title}</h3>
      <EditLink step={step} onGoToStep={onGoToStep} />
    </div>
  );
}

export function Step5({ data, departments, designations, submitting, onGoToStep }: Props) {
  const deptName = departments.find((d) => d.id === data.departmentId)?.name ?? data.departmentId;
  const desigName = designations.find((d) => d.id === data.designationId)?.name ?? data.designationId;

  const SHIFT_LABELS: Record<string, string> = {
    general: "General (9 AM – 6 PM)",
    morning: "Morning (6 AM – 2 PM)",
    evening: "Evening (2 PM – 10 PM)",
    night: "Night (10 PM – 6 AM)",
  };

  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 0, marginBottom: 8 }}>
        Step 5 — Review &amp; Submit
      </h2>
      <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20, marginTop: 0 }}>
        Review all details below. Click <strong>Edit</strong> on any section to go back and make changes.
      </p>

      {/* Step 1 — Personal */}
      <section style={SECTION} aria-label="Personal Info">
        <SectionHeader title="Personal Info" step={1} onGoToStep={onGoToStep} />
        <Row label="Full Name" value={data.fullName} />
        <Row label="Date of Birth" value={data.dateOfBirth} />
        <Row label="Gender" value={data.gender} />
        <Row label="Marital Status" value={data.maritalStatus} />
        <Row label="Blood Group" value={data.bloodGroup} />
        <Row label="Official Email" value={data.email} />
        <Row label="Mobile" value={data.mobile} />
      </section>

      {/* Step 2 — Employment */}
      <section style={SECTION} aria-label="Employment">
        <SectionHeader title="Employment" step={2} onGoToStep={onGoToStep} />
        <Row label="Employee ID" value={data.employeeNo} />
        <Row label="Department" value={deptName} />
        <Row label="Designation" value={desigName} />
        <Row label="Pay Grade" value={data.grade} />
        <Row label="Date of Joining" value={data.dateOfJoining} />
        <Row label="Employment Type" value={data.employeeType} />
      </section>

      {/* Step 3 — Assignment */}
      <section style={SECTION} aria-label="Assignment">
        <SectionHeader title="Assignment" step={3} onGoToStep={onGoToStep} />
        <Row label="Reporting Manager ID" value={data.managerId} />
        <Row label="Work Location" value={data.workLocation} />
        <Row label="Shift" value={data.shift ? SHIFT_LABELS[data.shift] : ""} />
        <Row label="Cost Center" value={data.costCenter} />
      </section>

      {/* Step 4 — Statutory */}
      <section style={SECTION} aria-label="Statutory & Finance">
        <SectionHeader title="Statutory & Finance" step={4} onGoToStep={onGoToStep} />
        <Row label="PAN" value={data.pan} masked />
        <Row label="Aadhaar Reference" value={data.aadhaarRef} masked />
        <Row label="Bank Account No" value={data.bankAccountNo} masked />
        <Row label="IFSC Code" value={data.bankIfsc} />
        <Row label="PF Enrolled" value={data.pfEnrolled} />
        <Row label="ESI Opt-in" value={data.esiEnrolled} />
        <Row label="PT Applicable" value={data.ptApplicable} />
      </section>

      {/* Compliance note */}
      <div
        style={{
          padding: "12px 16px",
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 8,
          fontSize: 12,
          color: "#78350f",
          marginBottom: 8,
        }}
      >
        <strong>Important:</strong> Sensitive fields (PAN, Aadhaar, Bank Account) are transmitted over TLS
        and stored AES-256 encrypted at rest in compliance with IT Act 2000 and DPDP Act 2023.
      </div>

      {submitting && (
        <p style={{ fontSize: 13, color: "#047857", fontWeight: 500, margin: "12px 0 0" }}>
          Creating employee record…
        </p>
      )}
    </>
  );
}
