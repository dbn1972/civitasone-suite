"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatRupees } from "@/lib/formatters";

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

/** Rupee input → paise, or undefined when left blank (server keeps the stored value). */
function toPaiseOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  return Math.round((parseFloat(v) || 0) * 100);
}

export function LwfConfigForm() {
  const t = useTranslations("lwfConfigForm");
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
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={stateId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("stateCodeLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={stateId}
                ref={stateRef}
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                maxLength={4}
                placeholder={t("stateCodePlaceholder")}
                aria-required="true"
                aria-invalid={stateInvalid || undefined}
                aria-describedby={stateInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600 }}>{t("employeeContributionLabel")}</label>
              <input
                id={empId}
                type="number" min="0" step="0.01"
                aria-describedby={hintId}
                value={empContrib}
                onChange={(e) => setEmpContrib(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={erId} style={{ fontSize: 13, fontWeight: 600 }}>{t("employerContributionLabel")}</label>
              <input
                id={erId}
                type="number" min="0" step="0.01"
                aria-describedby={hintId}
                value={erContrib}
                onChange={(e) => setErContrib(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={freqId} style={{ fontSize: 13, fontWeight: 600 }}>{t("frequencyLabel")}</label>
              <select
                id={freqId}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency | "")}
                aria-describedby={hintId}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="">{t("frequencyKeepCurrent")}</option>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{t(FREQUENCY_LABEL_KEY[f])}</option>
                ))}
              </select>
            </div>
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
        description={t.rich("confirmDescription", {
          strong: (chunks) => <strong>{chunks}</strong>,
          state: stateCode.trim().toUpperCase(),
          emp: empContrib.trim() === "" ? t("unchangedValue") : formatRupees(parseFloat(empContrib) || 0),
          er: erContrib.trim() === "" ? t("unchangedValue") : formatRupees(parseFloat(erContrib) || 0),
          frequency: frequency ? t(FREQUENCY_LABEL_KEY[frequency]) : t("unchangedValue"),
        })}
        onConfirm={() => void saveLwf()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
