"use client";

import { useTranslations } from "next-intl";
import type { WizardData, FieldErrors } from "../wizardTypes";
import {
  fieldWrap,
  grid2,
} from "../wizardTypes";
import { Field, Input, Select } from "@/app/_components/ds";

interface Props {
  data: WizardData;
  errors: FieldErrors;
  onChange: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
  onBlur: (field: keyof WizardData) => void;
}

export function Step1({ data, errors, onChange, onBlur }: Props) {
  const t = useTranslations("employeeWizard");
  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink, #0f172a)", marginTop: 0, marginBottom: 20 }}>
        {t("step1Heading")}
      </h2>
      <div style={grid2}>
        {/* Full Name */}
        <Field id="w-fullName" label={<>{t("fullNameLabel")} <span style={{ color: "var(--bad, #ef4444)" }} aria-hidden="true">*</span></>} required error={errors.fullName} announce style={{ ...fieldWrap, gridColumn: "span 2" }}>
          <Input
            type="text"
            autoComplete="name"
            value={data.fullName}
            onChange={(e) => onChange("fullName", e.target.value)}
            onBlur={() => onBlur("fullName")}
            placeholder={t("fullNamePlaceholder")}
          />
        </Field>

        {/* Date of Birth */}
        <Field id="w-dob" label={t("dobLabel")} error={errors.dateOfBirth} announce style={fieldWrap}>
          {/* GAP-HR-EMPLOYEES-NEW-08: `max` is an HTML-only guard -- it
              constrains the native date picker but a typed/pasted date
              bypassed it entirely, since nothing here re-checked it in JS.
              validateStep(1, ...) now enforces the same 18-year minimum
              server-side of this component (see wizardTypes.ts); this is
              just wiring its result up to a visible, announced error. */}
          <Input
            type="date"
            value={data.dateOfBirth}
            onChange={(e) => onChange("dateOfBirth", e.target.value)}
            onBlur={() => onBlur("dateOfBirth")}
            max={new Date(Date.now() - 18 * 365.25 * 24 * 3600 * 1000).toISOString().split("T")[0]}
          />
        </Field>

        {/* Gender */}
        <Field id="w-gender" label={t("genderLabel")} style={fieldWrap}>
          <Select
            value={data.gender}
            onChange={(e) => onChange("gender", e.target.value as WizardData["gender"])}
          >
            <option value="">{t("selectGender")}</option>
            <option value="male">{t("male")}</option>
            <option value="female">{t("female")}</option>
            <option value="other">{t("otherPreferNot")}</option>
          </Select>
        </Field>

        {/* Marital Status */}
        <Field id="w-marital" label={t("maritalStatusLabel")} style={fieldWrap}>
          <Select
            value={data.maritalStatus}
            onChange={(e) => onChange("maritalStatus", e.target.value as WizardData["maritalStatus"])}
          >
            <option value="">{t("selectStatus")}</option>
            <option value="single">{t("single")}</option>
            <option value="married">{t("married")}</option>
            <option value="divorced">{t("divorced")}</option>
            <option value="widowed">{t("widowed")}</option>
          </Select>
        </Field>

        {/* Blood Group */}
        <Field id="w-blood" label={t("bloodGroupLabel")} style={fieldWrap}>
          <Select
            value={data.bloodGroup}
            onChange={(e) => onChange("bloodGroup", e.target.value as WizardData["bloodGroup"])}
          >
            <option value="">{t("selectBloodGroup")}</option>
            {(["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"] as const).map((bg) => (
              <option key={bg} value={bg}>{bg}</option>
            ))}
          </Select>
        </Field>

        {/* Official Email */}
        <Field id="w-email" label={t("officialEmailLabel")} error={errors.email} announce style={fieldWrap}>
          <Input
            type="email"
            autoComplete="email"
            value={data.email}
            onChange={(e) => onChange("email", e.target.value)}
            onBlur={() => onBlur("email")}
            placeholder={t("emailPlaceholder")}
          />
        </Field>

        {/* Mobile */}
        <Field id="w-mobile" label={t("mobileLabel")} error={errors.mobile} announce style={fieldWrap}>
          <Input
            type="tel"
            autoComplete="tel"
            value={data.mobile}
            onChange={(e) => onChange("mobile", e.target.value)}
            onBlur={() => onBlur("mobile")}
            placeholder="+91 98765 43210"
          />
        </Field>
      </div>
    </>
  );
}
