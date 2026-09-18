"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

export function PtSlabForm() {
  const t = useTranslations("ptSlabForm");
  const router = useRouter();
  const [stateCode, setStateCode] = useState("");
  const [slabFrom, setSlabFrom] = useState("0");
  const [slabTo, setSlabTo] = useState("");
  const [ptAmount, setPtAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  // UX-017: message is now translated display text, so it can no longer be
  // compared/prefix-matched directly to decide which field is invalid (same
  // bug class as CreateCorrectionForm.tsx/tranche 11) -- invalidField is a
  // stable, untranslated identity kept separately from the display string.
  const [invalidField, setInvalidField] = useState<"stateCode" | "ptAmount" | null>(null);

  const stateId = useId();
  const fromId = useId();
  const toId = useId();
  const amtId = useId();
  const errId = useId();
  const stateRef = useRef<HTMLInputElement>(null);
  const amtRef = useRef<HTMLInputElement>(null);
  const stateInvalid = invalidField === "stateCode";
  const amtInvalid = invalidField === "ptAmount";

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
    const amt = parseFloat(ptAmount);
    if (Number.isNaN(amt) || amt < 0) {
      setTone("bad");
      setMessage(t("ptAmountInvalidError"));
      setInvalidField("ptAmount");
      amtRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function saveSlab() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const fromMinor = Math.round((parseFloat(slabFrom) || 0) * 100);
      const toMinor = slabTo.trim() ? Math.round(parseFloat(slabTo) * 100) : 999999999999;
      const taxMinor = Math.round((parseFloat(ptAmount) || 0) * 100);
      await browserJson("v1/payroll/statutory/state-rules", {
        method: "POST",
        body: JSON.stringify({
          stateCode: stateCode.trim().toUpperCase(),
          ptSlabs: [{ fromMinor, toMinor, taxMinor }],
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t("savedMessage", { state: stateCode.trim().toUpperCase() }));
      setStateCode(""); setSlabFrom("0"); setSlabTo(""); setPtAmount("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const slabToDisplay = slabTo.trim() ? `₹${slabTo}` : t("noUpperBound");

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
              <label htmlFor={fromId} style={{ fontSize: 13, fontWeight: 600 }}>{t("slabFromLabel")}</label>
              <input
                id={fromId}
                type="number" min="0" step="0.01"
                value={slabFrom}
                onChange={(e) => setSlabFrom(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={toId} style={{ fontSize: 13, fontWeight: 600 }}>{t("slabToLabel")}</label>
              <input
                id={toId}
                type="number" min="0" step="0.01"
                value={slabTo}
                onChange={(e) => setSlabTo(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amtId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("ptAmountLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={amtId}
                ref={amtRef}
                type="number" min="0" step="0.01"
                value={ptAmount}
                onChange={(e) => setPtAmount(e.target.value)}
                aria-required="true"
                aria-invalid={amtInvalid || undefined}
                aria-describedby={amtInvalid ? errId : undefined}
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
          from: slabFrom || 0,
          to: slabToDisplay,
          amount: ptAmount || 0,
        })}
        onConfirm={() => void saveSlab()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
