"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

export function LwfConfigForm() {
  const t = useTranslations("lwfConfigForm");
  const router = useRouter();
  const [stateCode, setStateCode] = useState("");
  const [empContrib, setEmpContrib] = useState("");
  const [erContrib, setErContrib] = useState("");
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
          lwfEmployee: Math.round((parseFloat(empContrib) || 0) * 100),
          lwfEmployer: Math.round((parseFloat(erContrib) || 0) * 100),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t("savedMessage", { state: stateCode.trim().toUpperCase() }));
      setStateCode(""); setEmpContrib(""); setErContrib("");
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
                value={erContrib}
                onChange={(e) => setErContrib(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

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
          emp: empContrib || 0,
          er: erContrib || 0,
        })}
        onConfirm={() => void saveLwf()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
