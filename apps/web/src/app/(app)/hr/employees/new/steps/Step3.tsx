"use client";

import { useTranslations } from "next-intl";
import type { WizardData, FieldErrors } from "../wizardTypes";
import {
  inputStyle,
  labelStyle,
  fieldWrap,
  grid2,
} from "../wizardTypes";
import { Field, EntityPicker } from "@/app/_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

interface Props {
  data: WizardData;
  errors: FieldErrors;
  onChange: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
  onBlur: (field: keyof WizardData) => void;
}

export function Step3({ data, errors: _errors, onChange, onBlur: _onBlur }: Props) {
  const t = useTranslations("employeeWizard");

  const SHIFTS: { value: WizardData["shift"]; label: string }[] = [
    { value: "general", label: t("shiftGeneral") },
    { value: "morning", label: t("shiftMorning") },
    { value: "evening", label: t("shiftEvening") },
    { value: "night", label: t("shiftNight") },
  ];

  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink, #0f172a)", marginTop: 0, marginBottom: 20 }}>
        {t("step3Heading")}
      </h2>
      <div style={grid2}>
        {/* GAP-HR-EMPLOYEES-NEW-04: this used to preload the first 200
            employees via a `?role=manager` param the backend silently
            ignores (employeeListQuery has no `role` field), with no
            designationName ever populated -- so on a tenant with >200
            employees, employee #250 could never be picked, and every
            option showed just a bare name. Swapped for the same
            EntityPicker + searchEmployees adapter EditEmployeeForm.tsx
            already uses for this exact "pick an employee" case (GAP-HR-SF-06)
            -- searches the real GET /v1/hrms/employees?q= as the user
            types, no preload, no row cap. */}
        <Field label={t("reportingManagerLabel")}>
          <EntityPicker
            value={data.managerId || null}
            onChange={(v) => onChange("managerId", (Array.isArray(v) ? v[0] : v) ?? "")}
            search={searchEmployees}
            resolve={resolveEmployees}
            placeholder={t("selectManagerSearchPlaceholder")}
            searchingText={t("pickerSearching")}
            noResultsText={t("pickerNoResults")}
          />
        </Field>

        {/* Work Location */}
        <div style={fieldWrap}>
          <label htmlFor="w-location" style={labelStyle}>{t("workLocationLabel")}</label>
          <input
            id="w-location"
            type="text"
            value={data.workLocation}
            onChange={(e) => onChange("workLocation", e.target.value)}
            placeholder={t("workLocationPlaceholder")}
            style={inputStyle}
          />
        </div>

        {/* Shift */}
        <div style={fieldWrap}>
          <label htmlFor="w-shift" style={labelStyle}>{t("shiftLabel")}</label>
          <select
            id="w-shift"
            value={data.shift}
            onChange={(e) => onChange("shift", e.target.value as WizardData["shift"])}
            style={inputStyle}
          >
            <option value="">{t("selectShift")}</option>
            {SHIFTS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Cost Center */}
        <div style={fieldWrap}>
          <label htmlFor="w-costCenter" style={labelStyle}>{t("costCenterLabel")}</label>
          <input
            id="w-costCenter"
            type="text"
            value={data.costCenter}
            onChange={(e) => onChange("costCenter", e.target.value)}
            placeholder={t("costCenterPlaceholder")}
            style={inputStyle}
          />
        </div>
      </div>

      <p style={{ marginTop: 20, marginBottom: 0, fontSize: 12, color: "var(--mut, #64748b)" }}>
        {t("assignmentOptionalNote")}
      </p>
    </>
  );
}
