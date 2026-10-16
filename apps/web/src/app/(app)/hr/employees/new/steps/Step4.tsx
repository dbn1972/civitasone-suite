"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { WizardData, FieldErrors } from "../wizardTypes";
import {
  fieldWrap,
  grid2,
} from "../wizardTypes";
import { Field, Input } from "@/app/_components/ds";

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
  hideValueLabel: string;
  showValueLabel: string;
  hideBtn: string;
  showBtn: string;
}) {
  const [reveal, setReveal] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <Input
        id={id}
        type={reveal ? "text" : "password"}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        style={{ paddingInlineEnd: 44 }}
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
          color: "var(--mut)",
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
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", marginTop: 0, marginBottom: 20 }}>
        {t("step4Heading")}
      </h2>

      <div style={grid2}>
        {/* PAN */}
        <Field id="w-pan" label={<>{t("panLabel")}
            <span style={{ fontWeight: 400, color: "var(--mut)", marginInlineStart: 6, fontSize: 11 }}>
              {t("storedEncrypted")}
            </span></>} error={errors.pan} announce style={fieldWrap}>
          <MaskedInput
            id="w-pan"
            value={data.pan}
            onChange={(v) => onChange("pan", v.toUpperCase())}
            onBlur={() => onBlur("pan")}
            placeholder={t("panPlaceholder")}
            maxLength={10}
            hideValueLabel={t("hideValue")}
            showValueLabel={t("showValue")}
            hideBtn={t("hideBtn")}
            showBtn={t("showBtn")}
          />
        </Field>

        {/* Aadhaar */}
        <Field id="w-aadhaar" label={<>{t("aadhaarRefLabel")}
            <span style={{ fontWeight: 400, color: "var(--mut)", marginInlineStart: 6, fontSize: 11 }}>
              {t("aadhaarHint")}
            </span></>} style={fieldWrap}>
          <MaskedInput
            id="w-aadhaar"
            value={data.aadhaarRef}
            onChange={(v) => onChange("aadhaarRef", v)}
            placeholder={t("aadhaarPlaceholder")}
            hideValueLabel={t("hideValue")}
            showValueLabel={t("showValue")}
            hideBtn={t("hideBtn")}
            showBtn={t("showBtn")}
          />
        </Field>

        {/* Bank Account */}
        <Field id="w-bank" label={<>{t("bankAccountNoLabel")}
            <span style={{ fontWeight: 400, color: "var(--mut)", marginInlineStart: 6, fontSize: 11 }}>
              {t("storedEncrypted")}
            </span></>} style={fieldWrap}>
          <MaskedInput
            id="w-bank"
            value={data.bankAccountNo}
            onChange={(v) => onChange("bankAccountNo", v)}
            placeholder={t("bankAccountPlaceholder")}
            hideValueLabel={t("hideValue")}
            showValueLabel={t("showValue")}
            hideBtn={t("hideBtn")}
            showBtn={t("showBtn")}
          />
        </Field>

        {/* IFSC */}
        <Field id="w-ifsc" label={t("ifscCodeLabel")} error={errors.bankIfsc} announce style={fieldWrap}>
          <Input
            type="text"
            value={data.bankIfsc}
            onChange={(e) => onChange("bankIfsc", e.target.value.toUpperCase())}
            onBlur={() => onBlur("bankIfsc")}
            placeholder={t("ifscPlaceholder")}
            maxLength={11}
          />
        </Field>
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
