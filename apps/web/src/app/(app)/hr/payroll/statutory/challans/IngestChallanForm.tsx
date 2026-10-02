"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../../_components/ds";
import { formatIndianDate, formatRupees } from "@/lib/formatters";
import { postWithErrorCode } from "../../_lib/postWithErrorCode";
import { rupeesToMinorString } from "@/lib/money";

type ChallanInvalidField = "bsr" | "amt" | "serial" | "date";

/**
 * First day of `period` (YYYY-MM) as YYYY-MM-DD, used only to compare against
 * depositDate for the (non-blocking) GAP-PAYROLL-STATUTORY-CHALLANS-05
 * advisory below -- not to validate or alter anything that gets submitted.
 */
function firstDayOfPeriod(period: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(period)) return null;
  return `${period}-01`;
}

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

  // GAP-PAYROLL-STATUTORY-CHALLANS-05 [HUMAN REVIEW: statutory compliance]:
  // advisory only, never blocks submission -- TDS deposit timing rules are a
  // tax-domain question this pass does not resolve (see the fix's own
  // hedge: "confirm with tax owner").
  const periodStart = firstDayOfPeriod(challanPeriod);
  const showDepositDateWarning = Boolean(periodStart && depositDate && depositDate < periodStart);

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
    // GAP-PAYROLL-STATUTORY-CHALLANS-02 [HUMAN REVIEW: statutory compliance]:
    // validated the same way every other money field in this codebase is
    // (rupeesToMinorString -- rejects non-numeric, negative, zero, and more
    // than 2 decimal places) instead of a bare parseFloat/NaN check. The
    // wire format itself is UNCHANGED: services/payroll-service/src/modules/
    // statutory-returns/challan-routes.ts's challanBodySchema expects
    // `tdsAmount` as a plain rupee number and does its own paise rounding
    // server-side (`Math.round(tdsAmount * 100)`) -- confirmed from that
    // route's actual Zod schema, not assumed. Converting to minor units on
    // the client and sending THAT instead would silently break a contract
    // that already works; only the client-side validation strictness
    // changes here.
    const tdsAmountMinor = rupeesToMinorString(tdsAmount);
    if (tdsAmountMinor == null) {
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
      // GAP-PAYROLL-STATUTORY-CHALLANS-01/06: a duplicate CIN (409) and a
      // rejected field (400) get their own messages instead of the one
      // generic "couldn't save" sentence for every failure.
      await postWithErrorCode("v1/payroll/statutory/challans", {
        period: challanPeriod,
        bsrCode,
        challanSerial: challanSerial.trim(),
        depositDate,
        formType,
        tdsAmount: parseFloat(tdsAmount),
      }, {
        DUPLICATE_CHALLAN: t("duplicateChallanError"),
        VALIDATION_FAILED: t("validationFailedError"),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidFields(new Set());
      setMessage(t("ingestedMessage", { period: challanPeriod }));
      const ingestedForDifferentPeriod = challanPeriod !== period;
      setBsrCode(""); setChallanSerial(""); setDepositDate(""); setTdsAmount("");
      // GAP-PAYROLL-STATUTORY-CHALLANS-05: ingesting for a period other than
      // the one being viewed used to call router.refresh(), which only
      // re-fetches the CURRENT URL's period -- the just-ingested row never
      // appeared without the user noticing and manually changing the period
      // selector. Navigate to the ingested period/form type instead.
      if (ingestedForDifferentPeriod) {
        router.push(`/hr/payroll/statutory/challans?period=${encodeURIComponent(challanPeriod)}&formType=${formType}`);
      } else {
        router.refresh();
      }
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
                aria-describedby={dateInvalid ? errId : (showDepositDateWarning ? `${dateId}-warning` : undefined)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {showDepositDateWarning && (
                <p id={`${dateId}-warning`} style={{ margin: 0, fontSize: 11, color: "var(--warn, #92400e)" }}>
                  {t("depositDateWarning", { period: challanPeriod })}
                </p>
              )}
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
          amount: formatRupees(parseFloat(tdsAmount) || 0),
          date: depositDate ? formatIndianDate(depositDate) : "—",
        })}
        onConfirm={() => void ingestChallan()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
