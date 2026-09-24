"use client";

import { useTranslations } from "next-intl";
import type { WizardData, FieldErrors } from "../wizardTypes";
import {
  inputStyle,
  inputErrorStyle,
  labelStyle,
  fieldWrap,
  grid2,
} from "../wizardTypes";

type Dept = { id: string; name: string };
type Desig = { id: string; name: string };

interface Props {
  data: WizardData;
  errors: FieldErrors;
  departments: Dept[];
  designations: Desig[];
  onChange: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
  onBlur: (field: keyof WizardData) => void;
}

// Canonical values persisted to the backend — must stay the original English
// strings regardless of locale (grade has no separate code/value pair, unlike
// gender/maritalStatus/employeeType, so the submitted `value` and the
// displayed label are deliberately decoupled here to avoid sending a
// translated string as the stored grade).
const GRADE_VALUES = [
  "Group A — Grade 1 (Pay Level 15–18)",
  "Group A — Grade 2 (Pay Level 12–14)",
  "Group B (Pay Level 6–11)",
  "Group C (Pay Level 1–5)",
  "MTS",
  "Contractual",
];

export function Step2({ data, errors, departments, designations, onChange, onBlur }: Props) {
  const t = useTranslations("employeeWizard");

  const GRADE_LABELS: Record<string, string> = {
    "Group A — Grade 1 (Pay Level 15–18)": t("gradeGroupA1"),
    "Group A — Grade 2 (Pay Level 12–14)": t("gradeGroupA2"),
    "Group B (Pay Level 6–11)": t("gradeGroupB"),
    "Group C (Pay Level 1–5)": t("gradeGroupC"),
    "MTS": t("gradeMts"),
    "Contractual": t("gradeContractual"),
  };

  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink, #0f172a)", marginTop: 0, marginBottom: 20 }}>
        {t("step2Heading")}
      </h2>
      <div style={grid2}>
        {/* Employee ID */}
        <div style={fieldWrap}>
          <label htmlFor="w-empNo" style={labelStyle}>
            {t("employeeIdFieldLabel")} <span style={{ color: "var(--bad, #ef4444)" }} aria-hidden="true">*</span>
          </label>
          <input
            id="w-empNo"
            type="text"
            value={data.employeeNo}
            onChange={(e) => onChange("employeeNo", e.target.value)}
            onBlur={() => onBlur("employeeNo")}
            placeholder={t("employeeIdPlaceholder")}
            aria-required="true"
            aria-invalid={!!errors.employeeNo}
            aria-describedby={errors.employeeNo ? "w-empNo-err" : undefined}
            style={errors.employeeNo ? inputErrorStyle : inputStyle}
          />
          {errors.employeeNo && (
            <span id="w-empNo-err" role="alert" style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>
              {errors.employeeNo}
            </span>
          )}
        </div>

        {/* Date of Joining */}
        <div style={fieldWrap}>
          <label htmlFor="w-doj" style={labelStyle}>
            {t("dateOfJoiningLabel")} <span style={{ color: "var(--bad, #ef4444)" }} aria-hidden="true">*</span>
          </label>
          <input
            id="w-doj"
            type="date"
            value={data.dateOfJoining}
            onChange={(e) => onChange("dateOfJoining", e.target.value)}
            onBlur={() => onBlur("dateOfJoining")}
            aria-required="true"
            aria-invalid={!!errors.dateOfJoining}
            aria-describedby={errors.dateOfJoining ? "w-doj-err" : undefined}
            style={errors.dateOfJoining ? inputErrorStyle : inputStyle}
          />
          {errors.dateOfJoining && (
            <span id="w-doj-err" role="alert" style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>
              {errors.dateOfJoining}
            </span>
          )}
        </div>

        {/* Department */}
        <div style={fieldWrap}>
          <label htmlFor="w-dept" style={labelStyle}>
            {t("departmentLabel")} <span style={{ color: "var(--bad, #ef4444)" }} aria-hidden="true">*</span>
          </label>
          <select
            id="w-dept"
            value={data.departmentId}
            onChange={(e) => onChange("departmentId", e.target.value)}
            onBlur={() => onBlur("departmentId")}
            aria-required="true"
            aria-invalid={!!errors.departmentId}
            aria-describedby={errors.departmentId ? "w-dept-err" : undefined}
            style={errors.departmentId ? inputErrorStyle : inputStyle}
          >
            <option value="">{t("selectDepartment")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          {errors.departmentId && (
            <span id="w-dept-err" role="alert" style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>
              {errors.departmentId}
            </span>
          )}
        </div>

        {/* Designation */}
        <div style={fieldWrap}>
          <label htmlFor="w-desig" style={labelStyle}>
            {t("designationLabel")} <span style={{ color: "var(--bad, #ef4444)" }} aria-hidden="true">*</span>
          </label>
          <select
            id="w-desig"
            value={data.designationId}
            onChange={(e) => onChange("designationId", e.target.value)}
            onBlur={() => onBlur("designationId")}
            aria-required="true"
            aria-invalid={!!errors.designationId}
            aria-describedby={errors.designationId ? "w-desig-err" : undefined}
            style={errors.designationId ? inputErrorStyle : inputStyle}
          >
            <option value="">{t("selectDesignation")}</option>
            {designations.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          {errors.designationId && (
            <span id="w-desig-err" role="alert" style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>
              {errors.designationId}
            </span>
          )}
        </div>

        {/* Grade */}
        <div style={fieldWrap}>
          <label htmlFor="w-grade" style={labelStyle}>{t("payGradeLabel")}</label>
          <select
            id="w-grade"
            value={data.grade}
            onChange={(e) => onChange("grade", e.target.value)}
            style={inputStyle}
          >
            <option value="">{t("selectGrade")}</option>
            {GRADE_VALUES.map((g) => (
              <option key={g} value={g}>{GRADE_LABELS[g]}</option>
            ))}
          </select>
        </div>

        {/* Employment Type */}
        <div style={fieldWrap}>
          <label htmlFor="w-empType" style={labelStyle}>{t("employmentTypeLabel")}</label>
          <select
            id="w-empType"
            value={data.employeeType}
            onChange={(e) => onChange("employeeType", e.target.value as WizardData["employeeType"])}
            style={inputStyle}
          >
            <option value="permanent">{t("empTypePermanent")}</option>
            <option value="contractual">{t("empTypeContractual")}</option>
            <option value="deputation">{t("empTypeDeputation")}</option>
            <option value="apprentice">{t("empTypeApprenticeTrainee")}</option>
          </select>
        </div>
      </div>
    </>
  );
}
