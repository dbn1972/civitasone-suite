"use client";

import { useTranslations } from "next-intl";
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
  borderBottom: "1px solid var(--line, #f1f5f9)",
  gap: 8,
};

const LABEL: React.CSSProperties = {
  fontSize: 12,
  color: "var(--mut, #64748b)",
  minWidth: 160,
  flexShrink: 0,
};

const VALUE: React.CSSProperties = {
  fontSize: 13,
  color: "var(--ink, #0f172a)",
  fontWeight: 500,
  textAlign: "end",
  wordBreak: "break-all",
};

const SECTION: React.CSSProperties = {
  marginBottom: 24,
  border: "1px solid var(--line, #e2e8f0)",
  borderRadius: 8,
  padding: "16px 20px",
};

const SECTION_HDR: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 12,
};

export function Step5({ data, departments, designations, submitting, onGoToStep }: Props) {
  const t = useTranslations("employeeWizardStep5");
  const deptName = departments.find((d) => d.id === data.departmentId)?.name ?? data.departmentId;
  const desigName = designations.find((d) => d.id === data.designationId)?.name ?? data.designationId;

  const SHIFT_LABELS: Record<string, string> = {
    general: t("shiftGeneral"),
    morning: t("shiftMorning"),
    evening: t("shiftEvening"),
    night: t("shiftNight"),
  };

  function EditLink({ step }: { step: number }) {
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
        {t("editLink")}
      </button>
    );
  }

  function Row({ label, value, masked }: { label: string; value?: string | boolean; masked?: boolean }) {
    const displayValue =
      typeof value === "boolean"
        ? value ? t("yes") : t("no")
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

  function SectionHeader({ title, step }: { title: string; step: number }) {
    return (
      <div style={SECTION_HDR}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--ink, #374151)" }}>{title}</h3>
        <EditLink step={step} />
      </div>
    );
  }

  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink, #0f172a)", marginTop: 0, marginBottom: 8 }}>
        {t("heading")}
      </h2>
      <p style={{ fontSize: 13, color: "var(--mut, #64748b)", marginBottom: 20, marginTop: 0 }}>
        {t.rich("introRich", { b: (chunks) => <strong>{chunks}</strong> })}
      </p>

      {/* Step 1 — Personal */}
      <section style={SECTION} aria-label={t("sectionPersonalInfo")}>
        <SectionHeader title={t("sectionPersonalInfo")} step={1} />
        <Row label={t("fullName")} value={data.fullName} />
        <Row label={t("dateOfBirth")} value={data.dateOfBirth} />
        <Row label={t("gender")} value={data.gender} />
        <Row label={t("maritalStatus")} value={data.maritalStatus} />
        <Row label={t("bloodGroup")} value={data.bloodGroup} />
        <Row label={t("officialEmail")} value={data.email} />
        <Row label={t("mobile")} value={data.mobile} />
      </section>

      {/* Step 2 — Employment */}
      <section style={SECTION} aria-label={t("sectionEmployment")}>
        <SectionHeader title={t("sectionEmployment")} step={2} />
        <Row label={t("employeeId")} value={data.employeeNo} />
        <Row label={t("department")} value={deptName} />
        <Row label={t("designation")} value={desigName} />
        <Row label={t("payGrade")} value={data.grade} />
        <Row label={t("dateOfJoining")} value={data.dateOfJoining} />
        <Row label={t("employmentType")} value={data.employeeType} />
      </section>

      {/* Step 3 — Assignment */}
      <section style={SECTION} aria-label={t("sectionAssignment")}>
        <SectionHeader title={t("sectionAssignment")} step={3} />
        <Row label={t("reportingManagerId")} value={data.managerId} />
        <Row label={t("workLocation")} value={data.workLocation} />
        <Row label={t("shift")} value={data.shift ? SHIFT_LABELS[data.shift] : ""} />
        <Row label={t("costCenter")} value={data.costCenter} />
      </section>

      {/* Step 4 — Statutory */}
      <section style={SECTION} aria-label={t("sectionStatutoryFinance")}>
        <SectionHeader title={t("sectionStatutoryFinance")} step={4} />
        <Row label={t("pan")} value={data.pan} masked />
        <Row label={t("aadhaarRef")} value={data.aadhaarRef} masked />
        <Row label={t("bankAccountNo")} value={data.bankAccountNo} masked />
        <Row label={t("ifscCode")} value={data.bankIfsc} />
        <Row label={t("pfEnrolled")} value={data.pfEnrolled} />
        <Row label={t("esiOptIn")} value={data.esiEnrolled} />
        <Row label={t("ptApplicable")} value={data.ptApplicable} />
      </section>

      {/* Compliance note */}
      <div
        style={{
          padding: "12px 16px",
          background: "var(--warnbg, #fffbeb)",
          border: "1px solid var(--warnbd, #fde68a)",
          borderRadius: 8,
          fontSize: 12,
          color: "var(--warn, #78350f)",
          marginBottom: 8,
        }}
      >
        <strong>{t("complianceImportant")}</strong> {t("complianceNote")}
      </div>

      {submitting && (
        <p style={{ fontSize: 13, color: "var(--good, #047857)", fontWeight: 500, margin: "12px 0 0" }}>
          {t("creatingRecord")}
        </p>
      )}
    </>
  );
}
