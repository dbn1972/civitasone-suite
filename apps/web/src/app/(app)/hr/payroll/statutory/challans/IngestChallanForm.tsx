"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type ChallanInvalidField = "bsr" | "amt" | "serial" | "date";

export function IngestChallanForm({ period }: { period: string }) {
  const t = useTranslations("ingestChallanForm");
  const router = useRouter();
  const [challanPeriod, setChallanPeriod] = useState(period);
  const [bsrCode, setBsrCode] = useState("");
  const [challanSerial, setChallanSerial] = useState("");
  const [depositDate, setDepositDate] = useState("");
  const [formType, setFormType] = useState<"24Q" | "26Q">("24Q");
  const [tdsAmount, setTdsAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  // UX-017: message is now translated display text, so it can no longer be
  // compared/prefix-matched to decide which field(s) are invalid (same bug
  // class as PtSlabForm.tsx/LwfConfigForm.tsx, tranche 12) -- invalidFields
  // is a stable, untranslated identity kept separately from the display
  // string. A Set rather than a single value (unlike PtSlabForm) because the
  // serial/date branch below can flag both fields invalid at once.
  const [invalidFields, setInvalidFields] = useState<Set<ChallanInvalidField>>(new Set());

  const periodId = useId();
  const bsrId = useId();
  const serialId = useId();
  const dateId = useId();
  const formTypeId = useId();
  const amtId = useId();
  const errId = useId();
  const bsrRef = useRef<HTMLInputElement>(null);
  const amtRef = useRef<HTMLInputElement>(null);
  const serialRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const bsrInvalid = invalidFields.has("bsr");
  const amtInvalid = invalidFields.has("amt");
  const serialInvalid = invalidFields.has("serial");
  const dateInvalid = invalidFields.has("date");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidFields(new Set());
    if (!/^\d{7}$/.test(bsrCode)) {
      setTone("bad");
      setMessage(t("bsrCodeInvalidError"));
      setInvalidFields(new Set(["bsr"]));
      bsrRef.current?.focus();
      return;
    }
    const amt = parseFloat(tdsAmount);
    if (Number.isNaN(amt) || amt < 0) {
      setTone("bad");
      setMessage(t("tdsAmountInvalidError"));
      setInvalidFields(new Set(["amt"]));
      amtRef.current?.focus();
      return;
    }
    if (!challanSerial.trim() || !depositDate) {
      setTone("bad");
      setMessage(t("serialDateRequiredError"));
      const missing = new Set<ChallanInvalidField>();
      if (!challanSerial.trim()) missing.add("serial");
      if (!depositDate) missing.add("date");
      setInvalidFields(missing);
      (!challanSerial.trim() ? serialRef : dateRef).current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function ingestChallan() {
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson("v1/payroll/statutory/challans", {
        method: "POST",
        body: JSON.stringify({
          period: challanPeriod,
          bsrCode,
          challanSerial: challanSerial.trim(),
          depositDate,
          formType,
          tdsAmount: parseFloat(tdsAmount),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidFields(new Set());
      setMessage(t("ingestedMessage", { period: challanPeriod }));
      setBsrCode(""); setChallanSerial(""); setDepositDate(""); setTdsAmount("");
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
              <label htmlFor={periodId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("periodLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={periodId}
                type="month"
                value={challanPeriod}
                onChange={(e) => setChallanPeriod(e.target.value)}
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={bsrId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("bsrCodeLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={bsrId}
                ref={bsrRef}
                value={bsrCode}
                onChange={(e) => setBsrCode(e.target.value)}
                maxLength={7}
                aria-required="true"
                aria-invalid={bsrInvalid || undefined}
                aria-describedby={bsrInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={serialId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("challanSerialLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={serialId}
                ref={serialRef}
                value={challanSerial}
                onChange={(e) => setChallanSerial(e.target.value)}
                aria-required="true"
                aria-invalid={serialInvalid || undefined}
                aria-describedby={serialInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dateId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("depositDateLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={dateId}
                ref={dateRef}
                type="date"
                value={depositDate}
                onChange={(e) => setDepositDate(e.target.value)}
                aria-required="true"
                aria-invalid={dateInvalid || undefined}
                aria-describedby={dateInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={formTypeId} style={{ fontSize: 13, fontWeight: 600 }}>{t("formTypeLabel")}</label>
              <select
                id={formTypeId}
                value={formType}
                onChange={(e) => setFormType(e.target.value as "24Q" | "26Q")}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "#fff" }}
              >
                <option value="24Q">{t("formType24qOption")}</option>
                <option value="26Q">{t("formType26qOption")}</option>
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amtId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("tdsAmountLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={amtId}
                ref={amtRef}
                type="number" min="0" step="0.01"
                value={tdsAmount}
                onChange={(e) => setTdsAmount(e.target.value)}
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
          formType,
          period: challanPeriod,
          bsr: bsrCode,
          serial: challanSerial,
          amount: tdsAmount || 0,
          date: depositDate || "—",
        })}
        onConfirm={() => void ingestChallan()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
