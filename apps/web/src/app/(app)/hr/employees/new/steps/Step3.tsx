"use client";

import { WorkStateSelect } from "../../WorkStateSelect";
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
import { searchCostCenters, resolveCostCenters } from "@/lib/entityAdapters/costCenter";
import { searchLocations, resolveLocations } from "@/lib/entityAdapters/location";

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
        {/* GAP-HR-LOCATIONS-03: pick from the location master (stores its id as
            locationId, and its name as the display `station`). The free-text
            box below is only for a place that is not in the master yet --
            it is disabled while a master location is picked. */}
        <div style={fieldWrap}>
          <span id="w-location-label" style={labelStyle}>{t("workLocationLabel")}</span>
          <EntityPicker
            value={data.locationId || null}
            onChange={(v) => {
              const id = (Array.isArray(v) ? v[0] : v) ?? "";
              onChange("locationId", id);
              if (!id) { onChange("workLocation", ""); return; }
              void resolveLocations([id]).then((o) => onChange("workLocation", o[0]?.label ?? ""));
            }}
            search={searchLocations}
            resolve={resolveLocations}
            placeholder={t("workLocationPlaceholder")}
            searchingText={t("pickerSearching")}
            noResultsText={t("pickerNoResults")}
          />
          <label htmlFor="w-location-text" style={{ ...labelStyle, fontWeight: 400, fontSize: 12 }}>{t("workLocationOtherLabel")}</label>
          <input
            id="w-location-text"
            type="text"
            value={data.locationId ? "" : data.workLocation}
            disabled={!!data.locationId}
            onChange={(e) => onChange("workLocation", e.target.value)}
            placeholder={t("workLocationOtherPlaceholder")}
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

        {/* State of employment (professional tax) */}
        <div style={fieldWrap}>
          <WorkStateSelect
            id="w-work-state" value={data.workStateCode} onChange={(v) => onChange("workStateCode", v)}
            label={t("workStateLabel")} placeholder={t("selectWorkState")} hint={t("workStateHint")}
            style={inputStyle} labelStyle={labelStyle}
          />
        </div>

        {/* Cost Center */}
        {/* GAP-HR-EMPLOYEES-NEW-01: a real picker over the finance cost-centre
            master -- the old free-text box never reached the record. */}
        <Field label={t("costCenterLabel")}>
          <EntityPicker
            value={data.costCenterId || null}
            onChange={(v) => onChange("costCenterId", (Array.isArray(v) ? v[0] : v) ?? "")}
            search={searchCostCenters}
            resolve={resolveCostCenters}
            placeholder={t("costCenterPlaceholder")}
            searchingText={t("pickerSearching")}
            noResultsText={t("pickerNoResults")}
          />
        </Field>
      </div>

      <p style={{ marginTop: 20, marginBottom: 0, fontSize: 12, color: "var(--mut, #64748b)" }}>
        {t("assignmentOptionalNote")}
      </p>
    </>
  );
}
