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
type EmployeeTypeOption = { code: string; name: string };

interface Props {
  data: WizardData;
  errors: FieldErrors;
  departments: Dept[];
  designations: Desig[];
  // GAP-HR-EMPLOYEES-NEW-06: real tenant employee-types master (falls back
  // to the historical 4-option list -- see FALLBACK_EMPLOYEE_TYPE_CODES
  // below -- only when the prop is omitted entirely, which happens in
  // existing tests that don't exercise this field; new/page.tsx always
  // passes a real array, including an explicit `[]` on a genuine fetch
  // failure, which is the case this gap is actually about).
  employeeTypes?: EmployeeTypeOption[];
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

// GAP-HR-EMPLOYEES-NEW-06: Employment Type was a hard-coded 4-option list
// (permanent/contractual/deputation/apprentice) even though the tenant
// employee-types master (GET /v1/hrms/employee-types) and the engagement
// catalogue both accept, and this wizard's own backend route already
// validates against, any tenant-defined code -- a tenant-specific type like
// "PSU-DEPUTEE" could never be chosen here. These four codes are kept only
// as the fallback when the caller omits `employeeTypes` entirely (see Props
// doc above) and as the translated-label set for whichever of them the real
// list also contains -- a custom tenant code just shows its own `name` from
// the API, unresolved through next-intl.
const FALLBACK_EMPLOYEE_TYPE_CODES = ["permanent", "contractual", "deputation", "apprentice"] as const;
const LEGACY_LABEL_KEY: Record<string, "empTypePermanent" | "empTypeContractual" | "empTypeDeputation" | "empTypeApprenticeTrainee"> = {
  permanent: "empTypePermanent",
  contractual: "empTypeContractual",
  deputation: "empTypeDeputation",
  apprentice: "empTypeApprenticeTrainee",
};

export function Step2({ data, errors, departments, designations, employeeTypes, onChange, onBlur }: Props) {
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

  // GAP-HR-EMPLOYEES-NEW-06: `employeeTypes === undefined` means the prop
  // was never passed (today, only pre-existing tests that don't exercise
  // this field) -- fall back to the historical options so that behavior is
  // unchanged. `employeeTypes === []` is a real, explicit "the tenant's
  // employee-types list is empty, or new/page.tsx's fetch failed" signal
  // from a real caller -- that must NOT silently fall back to the 4 hard-
  // coded options (the actual bug this closes), so it shows a disabled
  // control with a clear inline error instead.
  const typesProvided = employeeTypes !== undefined;
  const typesLoadFailed = typesProvided && employeeTypes.length === 0;
  const typeOptions: EmployeeTypeOption[] = typesProvided
    ? employeeTypes
    : FALLBACK_EMPLOYEE_TYPE_CODES.map((code) => ({ code, name: code }));

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
            onChange={(e) => onChange("employeeType", e.target.value)}
            disabled={typesLoadFailed}
            aria-invalid={typesLoadFailed}
            aria-describedby={typesLoadFailed ? "w-empType-err" : undefined}
            style={inputStyle}
          >
            {typesLoadFailed
              ? <option value={data.employeeType}>{data.employeeType}</option>
              : typeOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {LEGACY_LABEL_KEY[o.code] ? t(LEGACY_LABEL_KEY[o.code]) : o.name}
                </option>
              ))}
          </select>
          {typesLoadFailed && (
            <span id="w-empType-err" role="status" style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>
              {t("employmentTypeLoadError")}
            </span>
          )}
        </div>

        {/* GAP-HR-EMPLOYEES-NEW-02: Basic Pay -- every new employee used to
            be created at basicMinor 0 with no way to set it anywhere in
            this wizard. Optional here (pay may instead be fixed via a
            pay-structure assignment on the profile after creation, see
            EditEmployeeForm.tsx's EntityPicker) -- but if entered, must be
            a valid decimal-safe rupee amount (validateStep). */}
        <div style={fieldWrap}>
          <label htmlFor="w-basicPay" style={labelStyle}>
            {t("basicPayLabel")}
            <span style={{ fontWeight: 400, color: "var(--mut, #64748b)", marginInlineStart: 6, fontSize: 11 }}>
              {t("basicPayHint")}
            </span>
          </label>
          <input
            id="w-basicPay"
            type="text"
            inputMode="decimal"
            value={data.basicPay}
            onChange={(e) => onChange("basicPay", e.target.value)}
            onBlur={() => onBlur("basicPay")}
            placeholder={t("basicPayPlaceholder")}
            aria-invalid={!!errors.basicPay}
            aria-describedby={errors.basicPay ? "w-basicPay-err" : undefined}
            style={errors.basicPay ? inputErrorStyle : inputStyle}
          />
          {errors.basicPay && (
            <span id="w-basicPay-err" role="alert" style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>
              {errors.basicPay}
            </span>
          )}
        </div>
      </div>
    </>
  );
}
