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
        <div style={{ ...fieldWrap, gridColumn: "span 2" }}>
          <label htmlFor="w-fullName" style={labelStyle}>
            {t("fullNameLabel")} <span style={{ color: "var(--bad, #ef4444)" }} aria-hidden="true">*</span>
          </label>
          <input
            id="w-fullName"
            type="text"
            autoComplete="name"
            value={data.fullName}
            onChange={(e) => onChange("fullName", e.target.value)}
            onBlur={() => onBlur("fullName")}
            placeholder={t("fullNamePlaceholder")}
            aria-required="true"
            aria-invalid={!!errors.fullName}
            aria-describedby={errors.fullName ? "w-fullName-err" : undefined}
            style={errors.fullName ? inputErrorStyle : inputStyle}
          />
          {errors.fullName && (
            <span id="w-fullName-err" role="alert" style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>
              {errors.fullName}
            </span>
          )}
        </div>

        {/* Date of Birth */}
        <div style={fieldWrap}>
          <label htmlFor="w-dob" style={labelStyle}>{t("dobLabel")}</label>
          <input
            id="w-dob"
            type="date"
            value={data.dateOfBirth}
            onChange={(e) => onChange("dateOfBirth", e.target.value)}
            style={inputStyle}
            max={new Date(Date.now() - 18 * 365.25 * 24 * 3600 * 1000).toISOString().split("T")[0]}
          />
        </div>

        {/* Gender */}
        <div style={fieldWrap}>
          <label htmlFor="w-gender" style={labelStyle}>{t("genderLabel")}</label>
          <select
            id="w-gender"
            value={data.gender}
            onChange={(e) => onChange("gender", e.target.value as WizardData["gender"])}
            style={inputStyle}
          >
            <option value="">{t("selectGender")}</option>
            <option value="male">{t("male")}</option>
            <option value="female">{t("female")}</option>
            <option value="other">{t("otherPreferNot")}</option>
          </select>
        </div>

        {/* Marital Status */}
        <div style={fieldWrap}>
          <label htmlFor="w-marital" style={labelStyle}>{t("maritalStatusLabel")}</label>
          <select
            id="w-marital"
            value={data.maritalStatus}
            onChange={(e) => onChange("maritalStatus", e.target.value as WizardData["maritalStatus"])}
            style={inputStyle}
          >
            <option value="">{t("selectStatus")}</option>
            <option value="single">{t("single")}</option>
            <option value="married">{t("married")}</option>
            <option value="divorced">{t("divorced")}</option>
            <option value="widowed">{t("widowed")}</option>
          </select>
        </div>

        {/* Blood Group */}
        <div style={fieldWrap}>
          <label htmlFor="w-blood" style={labelStyle}>{t("bloodGroupLabel")}</label>
          <select
            id="w-blood"
            value={data.bloodGroup}
            onChange={(e) => onChange("bloodGroup", e.target.value as WizardData["bloodGroup"])}
            style={inputStyle}
          >
            <option value="">{t("selectBloodGroup")}</option>
            {(["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"] as const).map((bg) => (
              <option key={bg} value={bg}>{bg}</option>
            ))}
          </select>
        </div>

        {/* Official Email */}
        <div style={fieldWrap}>
          <label htmlFor="w-email" style={labelStyle}>{t("officialEmailLabel")}</label>
          <input
            id="w-email"
            type="email"
            autoComplete="email"
            value={data.email}
            onChange={(e) => onChange("email", e.target.value)}
            onBlur={() => onBlur("email")}
            placeholder={t("emailPlaceholder")}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "w-email-err" : undefined}
            style={errors.email ? inputErrorStyle : inputStyle}
          />
          {errors.email && (
            <span id="w-email-err" role="alert" style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>
              {errors.email}
            </span>
          )}
        </div>

        {/* Mobile */}
        <div style={fieldWrap}>
          <label htmlFor="w-mobile" style={labelStyle}>{t("mobileLabel")}</label>
          <input
            id="w-mobile"
            type="tel"
            autoComplete="tel"
            value={data.mobile}
            onChange={(e) => onChange("mobile", e.target.value)}
            onBlur={() => onBlur("mobile")}
            placeholder="+91 98765 43210"
            aria-invalid={!!errors.mobile}
            aria-describedby={errors.mobile ? "w-mobile-err" : undefined}
            style={errors.mobile ? inputErrorStyle : inputStyle}
          />
          {errors.mobile && (
            <span id="w-mobile-err" role="alert" style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>
              {errors.mobile}
            </span>
          )}
        </div>
      </div>
    </>
  );
}
