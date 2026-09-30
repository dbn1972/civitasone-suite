"use client";

import { useState } from "react";
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

/** A text input that shows masked dots but stores plaintext in state */
function MaskedInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  maxLength,
  hasError,
  errorId,
  hideValueLabel,
  showValueLabel,
  hideBtn,
  showBtn,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  maxLength?: number;
  hasError?: boolean;
  errorId?: string;
  hideValueLabel: string;
  showValueLabel: string;
  hideBtn: string;
  showBtn: string;
}) {
  const [reveal, setReveal] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        type={reveal ? "text" : "password"}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={hasError}
        aria-describedby={errorId}
        style={{
          ...(hasError ? inputErrorStyle : inputStyle),
          paddingInlineEnd: 44,
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={reveal ? hideValueLabel : showValueLabel}
        onClick={() => setReveal((r) => !r)}
        style={{
          position: "absolute",
          insetInlineEnd: 10,
          top: "50%",
          transform: "translateY(-50%)",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--mut, #64748b)",
          fontSize: 14,
          padding: "2px 4px",
          lineHeight: 1,
        }}
      >
        {reveal ? hideBtn : showBtn}
      </button>
    </div>
  );
}

export function Step4({ data, errors, onChange, onBlur }: Props) {
  const t = useTranslations("employeeWizard");
  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink, #0f172a)", marginTop: 0, marginBottom: 20 }}>
        {t("step4Heading")}
      </h2>

      <div style={grid2}>
        {/* PAN */}
        <div style={fieldWrap}>
          <label htmlFor="w-pan" style={labelStyle}>
            {t("panLabel")}
            <span style={{ fontWeight: 400, color: "var(--mut, #64748b)", marginInlineStart: 6, fontSize: 11 }}>
              {t("storedEncrypted")}
            </span>
          </label>
          <MaskedInput
            id="w-pan"
            value={data.pan}
            onChange={(v) => onChange("pan", v.toUpperCase())}
            onBlur={() => onBlur("pan")}
            placeholder={t("panPlaceholder")}
            maxLength={10}
            hasError={!!errors.pan}
            errorId={errors.pan ? "w-pan-err" : undefined}
            hideValueLabel={t("hideValue")}
            showValueLabel={t("showValue")}
            hideBtn={t("hideBtn")}
            showBtn={t("showBtn")}
          />
          {errors.pan && (
            <span id="w-pan-err" role="alert" style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>
              {errors.pan}
            </span>
          )}
        </div>

        {/* Aadhaar */}
        <div style={fieldWrap}>
          <label htmlFor="w-aadhaar" style={labelStyle}>
            {t("aadhaarRefLabel")}
            <span style={{ fontWeight: 400, color: "var(--mut, #64748b)", marginInlineStart: 6, fontSize: 11 }}>
              {t("aadhaarHint")}
            </span>
          </label>
          <MaskedInput
            id="w-aadhaar"
            value={data.aadhaarRef}
            onChange={(v) => onChange("aadhaarRef", v)}
            placeholder={t("aadhaarPlaceholder")}
            hasError={false}
            hideValueLabel={t("hideValue")}
            showValueLabel={t("showValue")}
            hideBtn={t("hideBtn")}
            showBtn={t("showBtn")}
          />
        </div>

        {/* Bank Account */}
        <div style={fieldWrap}>
          <label htmlFor="w-bank" style={labelStyle}>
            {t("bankAccountNoLabel")}
            <span style={{ fontWeight: 400, color: "var(--mut, #64748b)", marginInlineStart: 6, fontSize: 11 }}>
              {t("storedEncrypted")}
            </span>
          </label>
          <MaskedInput
            id="w-bank"
            value={data.bankAccountNo}
            onChange={(v) => onChange("bankAccountNo", v)}
            placeholder={t("bankAccountPlaceholder")}
            hasError={false}
            hideValueLabel={t("hideValue")}
            showValueLabel={t("showValue")}
            hideBtn={t("hideBtn")}
            showBtn={t("showBtn")}
          />
        </div>

        {/* IFSC */}
        <div style={fieldWrap}>
          <label htmlFor="w-ifsc" style={labelStyle}>{t("ifscCodeLabel")}</label>
          <input
            id="w-ifsc"
            type="text"
            value={data.bankIfsc}
            onChange={(e) => onChange("bankIfsc", e.target.value.toUpperCase())}
            onBlur={() => onBlur("bankIfsc")}
            placeholder={t("ifscPlaceholder")}
            maxLength={11}
            aria-invalid={!!errors.bankIfsc}
            aria-describedby={errors.bankIfsc ? "w-ifsc-err" : undefined}
            style={errors.bankIfsc ? inputErrorStyle : inputStyle}
          />
          {errors.bankIfsc && (
            <span id="w-ifsc-err" role="alert" style={{ fontSize: 12, color: "var(--bad, #b91c1c)" }}>
              {errors.bankIfsc}
            </span>
          )}
        </div>
      </div>
      {/* GAP-HR-EMPLOYEES-NEW-01: the PF/ESI/PT opt-in toggles that used to
          sit here were removed, not just left unsent -- they're already
          derived from the selected engagement type's policy
          (engagement-policy.ts statutoryPf/statutoryEsi) server-side, so a
          form toggle here could only ever silently disagree with, and never
          actually override, that computed value. */}
    </>
  );
}
