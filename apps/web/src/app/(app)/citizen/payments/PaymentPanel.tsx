"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ActionButton, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney, formatMoneyIn } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export interface PaymentSchedule {
  id: string;
  name: string;
  /** Base fee in MINOR units (paise) as a numeric string — see citizenGaps.FeeSchedule. */
  baseAmount: string;
  currency: string;
}

type PaymentMode = "cash" | "cheque" | "dd";

/** SVC-085 — record an offline payment (issues a receipt), behind a confirm step. */
export function PaymentPanel({
  schedules,
  loadFailed = false,
}: {
  schedules: PaymentSchedule[];
  loadFailed?: boolean;
}) {
  const t = useTranslations("citizenPayments");
  const router = useRouter();
  const [scheduleId, setScheduleId] = useState(schedules[0]?.id ?? "");
  const [applicationId, setApplicationId] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("cash");
  const [instrumentRef, setInstrumentRef] = useState("");
  const [payerName, setPayerName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [receiptNo, setReceiptNo] = useState("");

  // GAP-CITIZEN-PAYMENTS-04: re-initialise the selected schedule when the
  // schedule list changes (e.g. after router.refresh() recovers data from a
  // transient fetch error) — the initial useState only runs once.
  const firstScheduleId = schedules[0]?.id ?? "";
  useEffect(() => {
    if (!scheduleId && firstScheduleId) setScheduleId(firstScheduleId);
    // Only widen the selection when nothing valid is selected yet; never
    // override a deliberate user choice.
  }, [firstScheduleId, scheduleId]);

  const selected = useMemo(() => schedules.find((s) => s.id === scheduleId), [schedules, scheduleId]);
  const amountPreview = selected
    ? (selected.currency && selected.currency !== "INR"
        ? formatMoneyIn(selected.baseAmount, selected.currency)
        : formatMoney(selected.baseAmount))
    : "—";

  // GAP-CITIZEN-PAYMENTS-04: when the schedules fetch failed the form cannot
  // be used safely (no schedule to charge against), so replace it with a
  // retry state rather than a silently-disabled "No schedules" dropdown.
  if (loadFailed) {
    return (
      <div className="card">
        <div className="pad">
          <RefreshErrorState error={toHumanError("load", { area: "fee schedules" })} backHref="/citizen" />
        </div>
      </div>
    );
  }

  const chequeOrDd = paymentMode === "cheque" || paymentMode === "dd";
  const canSubmit = Boolean(scheduleId && applicationId) && (!chequeOrDd || instrumentRef.trim().length > 0);

  async function record() {
    setError("");
    setMessage("");
    const res = await fetch("/api/proxy/v1/citizen/payments/offline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        applicationId,
        scheduleId,
        method: paymentMode,
        ...(instrumentRef.trim() ? { instrumentRef: instrumentRef.trim() } : {}),
        ...(payerName.trim() ? { payerName: payerName.trim() } : {}),
        subject: {},
      }),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
    const body = await res.json();
    // GAP-CITIZEN-PAYMENTS-01: body.amount is paise (bigint). Render as ₹
    // with en-IN grouping (or the receipt's own currency), never "INR 1500".
    const amountDisplay = body.currency ? formatMoneyIn(body.amount, body.currency) : formatMoney(body.amount);
    const issuedNo = String(body.receiptNo ?? "");
    setReceiptNo(issuedNo);
    setMessage(t("receiptIssued", { receiptNo: issuedNo, amount: amountDisplay }));
    router.refresh();
  }

  return (
    <div className="card">
      <div className="pad" style={{ maxWidth: 620 }}>
        <h4 style={{ marginTop: 0 }}>{t("formTitle")}</h4>
        <label htmlFor="pay-schedule" style={labelStyle}>{t("scheduleLabel")}</label>
        <select id="pay-schedule" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} style={inputStyle}>
          {schedules.length === 0 ? <option value="">{t("noSchedules")}</option> : null}
          {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <label htmlFor="pay-app" style={labelStyle}>{t("applicationIdLabel")}</label>
        <input id="pay-app" value={applicationId} onChange={(e) => setApplicationId(e.target.value)} style={inputStyle} placeholder="00000000-0000-4000-8000-000000000000" />

        <label htmlFor="pay-mode" style={labelStyle}>{t("paymentModeLabel")}</label>
        <select id="pay-mode" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as PaymentMode)} style={inputStyle}>
          <option value="cash">{t("paymentModeCash")}</option>
          <option value="cheque">{t("paymentModeCheque")}</option>
          <option value="dd">{t("paymentModeDd")}</option>
        </select>

        {chequeOrDd ? (
          <>
            <label htmlFor="pay-instrument" style={labelStyle}>{t("instrumentRefLabel")}</label>
            <input id="pay-instrument" value={instrumentRef} onChange={(e) => setInstrumentRef(e.target.value)} style={inputStyle} />
          </>
        ) : null}

        <label htmlFor="pay-payer" style={labelStyle}>{t("payerNameLabel")}</label>
        <input id="pay-payer" value={payerName} onChange={(e) => setPayerName(e.target.value)} style={inputStyle} />

        {/* GAP-CITIZEN-PAYMENTS-02: a financial record must not post on a
            single click. ActionButton gates it behind a ConfirmDialog that
            previews the amount about to be charged; cancelling posts nothing. */}
        <ActionButton
          label={t("recordAndIssue")}
          disabled={!canSubmit}
          confirmTitle={t("confirmRecordTitle")}
          confirmDescription={`${t("confirmRecordBody")} — ${amountPreview}`}
          confirmLabel={t("confirmRecordCta")}
          onConfirm={record}
        />

        {message ? (
          <div role="status" aria-live="polite" style={{ marginTop: 12 }}>
            <p style={{ color: "#067647", fontSize: 13, margin: 0 }}>{message}</p>
            {receiptNo ? (
              /* GAP-CITIZEN-PAYMENTS-06: let the clerk print the just-issued
                 receipt instead of only reading its number. */
              <Button type="button" variant="ghost" style={{ minHeight: 44, marginTop: 8 }} onClick={() => window.print()}>
                {t("printReceipt")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {error ? <p role="alert" aria-live="assertive" style={{ color: "#b42318", fontSize: 13 }}>{error}</p> : null}
      </div>
    </div>
  );
}
