"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import type { WizardData, FieldErrors } from "../wizardTypes";
import {
  inputStyle,
  inputErrorStyle,
  labelStyle,
  fieldWrap,
  grid2,
} from "../wizardTypes";
import { serviceGroup, type ServiceGroup } from "@/lib/payLevels";

type Dept = { id: string; name: string };
type Desig = { id: string; name: string; level?: number | null };

interface Props {
  data: WizardData;
  errors: FieldErrors;
  departments: Dept[];
  designations: Desig[];
  onChange: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
  onBlur: (field: keyof WizardData) => void;
}

// GAP-HR-EMPLOYEES-NEW-05: this used to be its own free-text picklist
// (GRADE_VALUES) with level ranges hand-typed into the option labels, which
// silently disagreed with DesignationsTable.tsx's boundaries (level 1-3 and
// 10-11 landed in a different group depending on which screen you looked
// at). Group A/B/C are now derived from the selected designation's pay level
// via the one shared `serviceGroup()` helper (apps/web/src/lib/payLevels.ts)
// instead. MTS and Contractual aren't pay-matrix groups at all (MTS is
// technically Level 1 / Group C, and a contractual hire may have no formal
// level yet), so those two stay a manual pick — only shown when no
// designation with a classifiable level is selected, so they can never be
// chosen alongside, or silently override, a computed Group A/B/C.
const GROUP_LABEL_KEY: Record<ServiceGroup, "gradeGroupA" | "gradeGroupB" | "gradeGroupC"> = {
  "Group-A": "gradeGroupA",
  "Group-B": "gradeGroupB",
  "Group-C": "gradeGroupC",
};

export function Step2({ data, errors, departments, designations, onChange, onBlur }: Props) {
  const t = useTranslations("employeeWizard");

  const selectedLevel = designations.find((d) => d.id === data.designationId)?.level ?? null;
  const computedGroup = serviceGroup(selectedLevel);

  // Keep data.grade in sync with the computed group as the designation
  // selection changes (including on restoring an in-progress draft) — but
  // never clobber a manual MTS/Contractual pick with a stale computed value.
  useEffect(() => {
    if (computedGroup) {
      if (data.grade !== computedGroup) onChange("grade", computedGroup);
    } else if (data.grade === "Group-A" || data.grade === "Group-B" || data.grade === "Group-C") {
      onChange("grade", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedGroup]);

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

        {/* Grade / Service Group */}
        <div style={fieldWrap}>
          <span id="w-grade-label" style={labelStyle}>{t("payGradeLabel")}</span>
          {computedGroup ? (
            <>
              <div
                id="w-grade"
                aria-labelledby="w-grade-label"
                style={{ ...inputStyle, display: "flex", alignItems: "center", background: "var(--bg, #f8fafc)" }}
              >
                {t(GROUP_LABEL_KEY[computedGroup])}
              </div>
              <span style={{ fontSize: 11, color: "var(--mut, #94a3b8)" }}>{t("gradeComputedNote")}</span>
            </>
          ) : (
            <select
              id="w-grade"
              aria-labelledby="w-grade-label"
              value={data.grade}
              onChange={(e) => onChange("grade", e.target.value)}
              style={inputStyle}
            >
              <option value="">{t("selectGrade")}</option>
              <option value="MTS">{t("gradeMts")}</option>
              <option value="Contractual">{t("gradeContractual")}</option>
            </select>
          )}
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
