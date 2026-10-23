"use client";

/**
 * GAP-FINANCE-PAYMENTS-01: New Payment. Replaces the one-line "+ New Payment"
 * dialog that POSTed { action: "release", reason } -- no beneficiary, amount,
 * mode or bill, which finance-service's initiateEftBody rejects. The payment
 * is raised against a PASSED bill: the beneficiary (vendor) and the amount
 * come from the bill (the server enforces payment === bill net), and the
 * officer chooses the DDO and mode, then confirms the exact figures before
 * anything is sent. Maker-checker stays server-side (the payer must differ
 * from the bill's creator and passer). x-idempotency-key prevents a double
 * click from disbursing twice. The confirm step captures the officer's reason,
 * which finance-service writes (with the paise amount) to the payment's audit event.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { formatMoney } from "@/lib/formatters";
import { PAYMENT_MODES, PAYMENT_REASON_MAX, PAYMENT_REASON_MIN, attachPaymentReason, buildInitiatePaymentRequest } from "@/lib/finance/billForm";

export interface PayableBill {
  id: string;
  billNo: string;
  vendor: string;
  /** Net payable, paise string. */
  amount: string;
}

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const errStyle = { fontSize: 12, color: "var(--bad)" } as const;

export function NewPaymentForm({
  bills,
  ddos,
  initialBillId,
  hiddenBillCount = 0,
}: {
  bills: PayableBill[];
  ddos: { id: string; label: string }[];
  initialBillId?: string | undefined;
  /** Passed bills left out because the signed-in officer created or passed them (segregation of duties). */
  hiddenBillCount?: number;
}) {
  const t = useTranslations("financePaymentForm");
  const router = useRouter();
  const formError = useFormError("payment");
  const [billId, setBillId] = useState(bills.some((b) => b.id === initialBillId) ? (initialBillId as string) : "");
  const [ddoCode, setDdoCode] = useState(ddos.length === 1 ? ddos[0].id : "");
  const [mode, setMode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const bill = bills.find((b) => b.id === billId);
  const input = { billId, ddoCode, mode, amountMinor: bill?.amount ?? "" };

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const r = buildInitiatePaymentRequest(input);
    if (!r.ok) {
      setErrors(r.errors as Record<string, string>);
      return;
    }
    setErrors({});
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submit(reason?: string) {
    const r = buildInitiatePaymentRequest(input);
    if (!r.ok) return;
    const withReason = attachPaymentReason(r.body, reason);
    if (!withReason.ok) {
      setDialogError(t(`err.${withReason.error}`));
      return;
    }
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await fetch("/api/proxy/v1/finance/payments/eft", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify(withReason.body),
      });
      if (!(res.ok || res.status === 202)) {
        setDialogError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setDone(true);
      setConfirmOpen(false);
      router.refresh();
      setTimeout(() => router.push("/finance/payments"), 700);
    } catch (caught) {
      setDialogError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {done ? <Alert variant="success">{t("success")}</Alert> : null}
      <div className="card">
        <form onSubmit={onSubmit} className="pad" noValidate>
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="pay-bill">{t("labelBill")}</label>
              <select id="pay-bill" value={billId} onChange={(e) => setBillId(e.target.value)} style={inputStyle}>
                <option value="">{t("selectBill")}</option>
                {bills.map((b) => <option key={b.id} value={b.id}>{`${b.billNo} — ${b.vendor} — ${formatMoney(b.amount)}`}</option>)}
              </select>
              {errors.billId ? <span role="alert" style={errStyle}>{t(`err.${errors.billId}`)}</span> : null}
              {bills.length === 0 ? <span style={{ fontSize: 12, color: "var(--ink2)" }}>{t("noPassedBills")}</span> : null}
              {hiddenBillCount > 0 ? <span role="note" style={{ fontSize: 12, color: "var(--ink2)" }}>{t("hiddenBills", { count: hiddenBillCount })}</span> : null}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <span className="l">{t("labelAmount")}</span>
              <output aria-live="polite" style={{ fontWeight: 600 }}>{bill ? formatMoney(bill.amount) : "—"}</output>
              {errors.amountMinor ? <span role="alert" style={errStyle}>{t(`err.${errors.amountMinor}`)}</span> : null}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="pay-ddo">{t("labelDdo")}</label>
              <select id="pay-ddo" value={ddoCode} onChange={(e) => setDdoCode(e.target.value)} style={inputStyle}>
                <option value="">{t("selectDdo")}</option>
                {ddos.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
              {errors.ddoCode ? <span role="alert" style={errStyle}>{t(`err.${errors.ddoCode}`)}</span> : null}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="pay-mode">{t("labelMode")}</label>
              <select id="pay-mode" value={mode} onChange={(e) => setMode(e.target.value)} style={inputStyle}>
                <option value="">{t("selectMode")}</option>
                {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              {errors.mode ? <span role="alert" style={errStyle}>{t(`err.${errors.mode}`)}</span> : null}
            </div>
          </div>
          <Button type="submit" disabled={busy || done} aria-busy={busy} style={{ marginTop: 12 }}>{t("review")}</Button>
        </form>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        danger
        title={t("confirmTitle")}
        description={t("confirmDescription", { mode, amount: bill ? formatMoney(bill.amount) : "—", vendor: bill?.vendor ?? t("fallbackVendor"), billNo: bill?.billNo ?? "" })}
        confirmLabel={t("confirmLabel")}
        requireReason
        reasonLabel={t("reasonLabel")}
        minReasonLength={PAYMENT_REASON_MIN}
        maxReasonLength={PAYMENT_REASON_MAX}
        busy={busy}
        {...(dialogError ? { errorMessage: dialogError } : {})}
        onConfirm={(reason) => { void submit(reason); }}
        onCancel={() => { setConfirmOpen(false); setDialogError(undefined); }}
      />
    </>
  );
}
