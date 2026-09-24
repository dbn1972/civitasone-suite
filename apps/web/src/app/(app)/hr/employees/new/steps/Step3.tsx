"use client";

import { useTranslations } from "next-intl";
import type { WizardData, FieldErrors } from "../wizardTypes";
import {
  inputStyle,
  labelStyle,
  fieldWrap,
  grid2,
} from "../wizardTypes";

type EmpSummary = { id: string; name: string; designationName?: string };

interface Props {
  data: WizardData;
  errors: FieldErrors;
  managers?: EmpSummary[];
  onChange: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
  onBlur: (field: keyof WizardData) => void;
}

export function Step3({ data, errors: _errors, managers, onChange, onBlur: _onBlur }: Props) {
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
        {/* Reporting Manager */}
        <div style={fieldWrap}>
          <label htmlFor="w-manager" style={labelStyle}>{t("reportingManagerLabel")}</label>
          <select
            id="w-manager"
            value={data.managerId}
            onChange={(e) => onChange("managerId", e.target.value)}
            style={inputStyle}
          >
            <option value="">{t("selectManager")}</option>
            {(managers ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.designationName ? ` — ${m.designationName}` : ""}
              </option>
            ))}
          </select>
        </div>

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
