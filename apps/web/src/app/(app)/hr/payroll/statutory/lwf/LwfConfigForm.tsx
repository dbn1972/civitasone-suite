"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, Field, Input, Select } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatRupees } from "@/lib/formatters";
import { nonNegativeRupeesToMinorString } from "@/lib/money";

// GAP-PAYROLL-STATUTORY-LWF-02: mirrors payroll-service LWF_FREQUENCIES
// (modules/payroll/state-rules.ts). "" = keep the stored frequency.
const FREQUENCIES = ["monthly", "quarterly", "half_yearly", "yearly"] as const;
type Frequency = (typeof FREQUENCIES)[number];
const FREQUENCY_LABEL_KEY = {
  monthly: "frequencyMonthly",
  quarterly: "frequencyQuarterly",
  half_yearly: "frequencyHalfYearly",
  yearly: "frequencyYearly",
} as const;

/**
 * Rupee input → paise, or undefined when left blank (server keeps the stored
 * value). GAP2-PAYROLL-STATUTORY-CHALLANS-01: converted via the shared,
 * float-free rupeesToMinorString family (bigint minor units) instead of
 * `Math.round(parseFloat(v) * 100)`, so a statutory LWF contribution never
 * crosses the wire as a mis-rounded float. The backend state-rules schema
 * takes an integer number of paise, so the paise STRING is read back as an
 * integer with Number(); the value is a small contribution amount, always
 * well within Number.MAX_SAFE_INTEGER paise.
 */
function toPaiseOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const minor = nonNegativeRupeesToMinorString(v);
  // A non-numeric / sub-paise entry resolves to 0 paise rather than a
  // float-rounded value (the field is a plain number input; the server
  // additionally validates it as a non-negative integer).
  return minor == null ? 0 : Number(minor);
}

type ExistingLwfConfig = { state_code: string };

/**
 * GAP-PAYROLL-STATUTORY-LWF-05 [HUMAN REVIEW: statutory compliance]: saving
 * an already-configured state now surfaces an explicit overwrite warning in
 * the confirm dialog, instead of a generic "Save / Update" title with no
 * indication that a repeat state replaces its stored values. A blank
 * contribution field still means "keep the stored value" (PR #1761 /
 * GAP-PAYROLL-STATUTORY-LWF-02), so it is deliberately NOT required here.
 */
export function LwfConfigForm({ existingConfigs = [] }: { existingConfigs?: ExistingLwfConfig[] }) {
  const t = useTranslations("lwfConfigForm");
  const tv = useTranslations("hrFormErrors2");
  const router = useRouter();
  const [stateCode, setStateCode] = useState("");
  const [empContrib, setEmpContrib] = useState("");
  const [erContrib, setErContrib] = useState("");
  const [frequency, setFrequency] = useState<Frequency | "">("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  // UX-017: message is now translated display text, so it can no longer be
  // compared directly to decide which field is invalid (same bug class as
  // CreateCorrectionForm.tsx/tranche 11) -- invalidField is a stable,
  // untranslated identity kept separately from the display string.
  const [invalidField, setInvalidField] = useState<"stateCode" | null>(null);
  const [isOverwrite, setIsOverwrite] = useState(false);

  const stateId = useId();
  const empId = useId();
  const erId = useId();
  const freqId = useId();
  const hintId = useId();
  const errId = useId();
  const stateRef = useRef<HTMLInputElement>(null);
  const stateInvalid = invalidField === "stateCode";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    if (!stateCode.trim()) {
      setTone("bad");
      setMessage(t("stateCodeRequiredError"));
      setInvalidField("stateCode");
      stateRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setIsOverwrite(existingConfigs.some((c) => (c.state_code ?? "").toUpperCase() === stateCode.trim().toUpperCase()));
    setConfirmOpen(true);
  }

  async function saveLwf() {
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson("v1/payroll/statutory/state-rules", {
        method: "POST",
        body: JSON.stringify({
          stateCode: stateCode.trim().toUpperCase(),
          // Blank fields are omitted, and the server keeps the stored value
          // (it used to reset an omitted employer share to 0).
          lwfEmployee: toPaiseOrUndefined(empContrib),
          lwfEmployer: toPaiseOrUndefined(erContrib),
          lwfFrequency: frequency || undefined,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t("savedMessage", { state: stateCode.trim().toUpperCase() }));
      setStateCode(""); setEmpContrib(""); setErContrib(""); setFrequency("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
            <Field id={stateId} label={t("stateCodeLabel")} required error={stateInvalid ? tv("fieldRequired") : undefined}>
              <Input
                ref={stateRef}
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                maxLength={4}
                placeholder={t("stateCodePlaceholder")}
                aria-describedby={hintId}
              />
            </Field>
            <Field id={empId} label={t("employeeContributionLabel")}>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={empContrib}
                onChange={(e) => setEmpContrib(e.target.value)}
                aria-describedby={hintId}
              />
            </Field>
            <Field id={erId} label={t("employerContributionLabel")}>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={erContrib}
                onChange={(e) => setErContrib(e.target.value)}
                aria-describedby={hintId}
              />
            </Field>
            <Field id={freqId} label={t("frequencyLabel")}>
              <Select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency | "")}
                aria-describedby={hintId}
              >
                <option value="">{t("frequencyKeepCurrent")}</option>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{t(FREQUENCY_LABEL_KEY[f])}</option>
                ))}
              </Select>
            </Field>
          </div>
          <p id={hintId} style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{t("blankKeepsCurrentHint")}</p>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              {t("submitBtn")}
            </Button>
          </div>

          {message && (
            <p
              id={errId}
              role={tone === "bad" ? "alert" : "status"}
              aria-live={tone === "bad" ? undefined : "polite"}
              className={`pill ${tone}`}
              style={{ width: "fit-content" }}
            >
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            {t.rich("confirmDescription", {
              strong: (chunks) => <strong>{chunks}</strong>,
              state: stateCode.trim().toUpperCase(),
              emp: empContrib.trim() === "" ? t("unchangedValue") : formatRupees(parseFloat(empContrib) || 0),
              er: erContrib.trim() === "" ? t("unchangedValue") : formatRupees(parseFloat(erContrib) || 0),
              frequency: frequency ? t(FREQUENCY_LABEL_KEY[frequency]) : t("unchangedValue"),
            })}
            {isOverwrite && (
              <>
                {" "}
                <strong>{t("overwriteWarning", { state: stateCode.trim().toUpperCase() })}</strong>
              </>
            )}
          </>
        }
        onConfirm={() => void saveLwf()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
