"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import type { PfmsBill, PfmsMode } from "./types";

type AdviceResult = {
  adviceId: string;
  pfmsRef: string;
  billId: string;
  amountMinor: number;
  status: string;
  submittedAt: string;
  message?: string;
  mode?: PfmsMode;
};

type AdviceStatusResult = {
  adviceId: string;
  status: string;
  pfmsTransactionId: string;
  processedAt: string;
  utrNumber: string;
  message?: string;
  mode?: PfmsMode;
};

type FieldKey = "billId" | "payeeName" | "payeeAccountNo" | "payeeAccountNoConfirm" | "payeeIfsc" | "amountMinor" | "purposeCode";

/** Bill statuses a payment advice can be raised against (passed for payment; "approved" is the legacy spelling). */
const PAYABLE_BILL_STATUSES = new Set(["passed", "approved"]);

/** The bills API falls back to a placeholder "Vendor (1234)" when it has no real name; never show or use that as a name. */
function realVendor(vendor: string): string {
  return /^Vendor \(.{1,8}\)$/.test(vendor) || !vendor ? "" : vendor;
}

interface PaymentAdviceFormProps {
  /**
   * Bills to pick from (GAP-FINANCE-PFMS-07). When empty (none payable, or the
   * bills endpoint was unavailable) the form falls back to the manual Bill ID
   * field so it never becomes unusable.
   */
  bills?: PfmsBill[];
  /** Reports the `mode` field of a successful response, once the backend adapter rollout starts sending it. */
  onModeObserved?: (mode: PfmsMode) => void;
}

/**
 * POST /v1/finance/pfms/payment-advice — generates a treasury payment advice.
 * Backend note: registered as an INTEGRATION STUB
 * (services/finance-service/src/modules/pfms/treasury-stubs.ts) — real route,
 * synthetic PFMS reference. `amountMinor` is paise per the backend schema
 * comment. Payee account number is a POST body field only, never placed in a
 * URL/query string.
 */
export function PaymentAdviceForm({ bills = [], onModeObserved }: PaymentAdviceFormProps) {
  const t = useTranslations("pfmsPaymentAdviceForm");
  const [billId, setBillId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [payeeAccountNo, setPayeeAccountNo] = useState("");
  const [payeeAccountNoConfirm, setPayeeAccountNoConfirm] = useState("");
  const [payeeIfsc, setPayeeIfsc] = useState("");
  const [amountMinor, setAmountMinor] = useState("");
  const [purposeCode, setPurposeCode] = useState("");
  const [ddoCode, setDdoCode] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [lastAdviceId, setLastAdviceId] = useState<string | null>(null);

  const billIdId = useId();
  const nameId = useId();
  const acctId = useId();
  const acctConfirmId = useId();
  const ifscId = useId();
  const amountId = useId();
  const purposeId = useId();
  const ddoId = useId();

  const billRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const acctRef = useRef<HTMLInputElement>(null);
  const acctConfirmRef = useRef<HTMLInputElement>(null);
  const billSelectRef = useRef<HTMLSelectElement>(null);
  const ifscRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const purposeRef = useRef<HTMLInputElement>(null);

  const [billSearch, setBillSearch] = useState("");
  const payableBills = bills.filter((b) => PAYABLE_BILL_STATUSES.has(b.status));
  const needle = billSearch.trim().toLowerCase();
  const shownBills = needle
    ? payableBills.filter((b) => `${b.billNo} ${realVendor(b.vendor)}`.toLowerCase().includes(needle) || b.id === billId)
    : payableBills;
  const hasBillPicker = payableBills.length > 0;

  function selectBill(id: string) {
    setBillId(id);
    const bill = payableBills.find((b) => b.id === id);
    if (!bill) return;
    // Only the amount is prefilled (the server requires it to equal the bill's
    // net). The payee is NOT: the bills API returns a placeholder "Vendor (xxxx)"
    // when it has no real name, and the payee name/account must be typed and
    // verified by the clerk. The amount stays editable; the server re-checks it.
    if (/^\d+$/.test(bill.amountMinor)) setAmountMinor(bill.amountMinor);
  }

  const FIELD_ERRORS: Record<FieldKey, string> = {
    billId: hasBillPicker ? t("billSelectRequired") : t("billIdRequired"),
    payeeName: t("payeeNameRequired"),
    payeeAccountNo: t("payeeAccountNoRequired"),
    payeeAccountNoConfirm: t("payeeAccountNoMismatch"),
    payeeIfsc: t("payeeIfscRequired"),
    amountMinor: t("amountRequired"),
    purposeCode: t("purposeCodeRequired"),
  };

  const focusRefs: Record<FieldKey, React.RefObject<HTMLInputElement | HTMLSelectElement | null>> = {
    billId: hasBillPicker ? billSelectRef : billRef,
    payeeName: nameRef,
    payeeAccountNo: acctRef,
    payeeAccountNoConfirm: acctConfirmRef,
    payeeIfsc: ifscRef,
    amountMinor: amountRef,
    purposeCode: purposeRef,
  };

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const nextErrors: Partial<Record<FieldKey, string>> = {};
    if (!uuidRe.test(billId.trim())) nextErrors.billId = FIELD_ERRORS.billId;
    if (!payeeName.trim()) nextErrors.payeeName = FIELD_ERRORS.payeeName;
    if (!payeeAccountNo.trim()) nextErrors.payeeAccountNo = FIELD_ERRORS.payeeAccountNo;
    else if (payeeAccountNo.trim() !== payeeAccountNoConfirm.trim()) nextErrors.payeeAccountNoConfirm = FIELD_ERRORS.payeeAccountNoConfirm;
    if (payeeIfsc.trim().length !== 11) nextErrors.payeeIfsc = FIELD_ERRORS.payeeIfsc;
    if (!/^\d+$/.test(amountMinor.trim()) || Number(amountMinor) < 1 || !Number.isSafeInteger(Number(amountMinor))) {
      nextErrors.amountMinor = FIELD_ERRORS.amountMinor;
    }
    if (!purposeCode.trim()) nextErrors.purposeCode = FIELD_ERRORS.purposeCode;
    setErrors(nextErrors);
    const firstInvalid = (Object.keys(nextErrors) as FieldKey[])[0];
    if (firstInvalid) {
      focusRefs[firstInvalid].current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submit() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<{ data: AdviceResult }>("v1/finance/pfms/payment-advice", {
        method: "POST",
        body: JSON.stringify({
          billId: billId.trim(),
          payeeName: payeeName.trim(),
          payeeAccountNo: payeeAccountNo.trim(),
          payeeIfsc: payeeIfsc.trim().toUpperCase(),
          amountMinor: Number(amountMinor.trim()),
          purposeCode: purposeCode.trim(),
          ddoCode: ddoCode.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      if (res.data.mode) onModeObserved?.(res.data.mode);
      setLastAdviceId(res.data.adviceId);
      setMessage(t("successMessage", { pfmsRef: res.data.pfmsRef, status: res.data.status }));
      setBillId("");
      setPayeeName("");
      setPayeeAccountNo("");
      setPayeeAccountNoConfirm("");
      setPayeeIfsc("");
      setAmountMinor("");
      setPurposeCode("");
      setDdoCode("");
      setErrors({});
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkErrorFallback"));
    } finally {
      setBusy(false);
    }
  }

  const previewAmount = /^\d+$/.test(amountMinor.trim()) ? formatMoney(amountMinor.trim()) : null;

  return (
    <>
      <form onSubmit={handleSubmit}>
        <Card title={t("title")} padding>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={billIdId} style={{ fontSize: 13, fontWeight: 600 }}>
                  {hasBillPicker ? t("billSelectLabel") : t("billIdLabel")} <span aria-hidden="true">*</span>
                </label>
                {hasBillPicker ? (
                  <>
                  <input
                    type="search"
                    value={billSearch}
                    onChange={(e) => setBillSearch(e.target.value)}
                    placeholder={t("billSearchPlaceholder")}
                    aria-label={t("billSearchLabel")}
                    autoComplete="off"
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                  />
                  <select
                    id={billIdId}
                    ref={billSelectRef}
                    value={billId}
                    onChange={(e) => selectBill(e.target.value)}
                    aria-required="true"
                    aria-invalid={!!errors.billId || undefined}
                    aria-describedby={errors.billId ? `${billIdId}-error` : undefined}
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                  >
                    <option value="">{t("billSelectPlaceholder")}</option>
                    {shownBills.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.billNo}
                        {realVendor(b.vendor) ? ` — ${realVendor(b.vendor)}` : ""}
                        {/^\d+$/.test(b.amountMinor) ? ` — ${formatMoney(b.amountMinor)}` : ""}
                      </option>
                    ))}
                  </select>
                  </>
                ) : (
                  <input
                    id={billIdId}
                    ref={billRef}
                    value={billId}
                    onChange={(e) => setBillId(e.target.value)}
                    aria-required="true"
                    aria-invalid={!!errors.billId || undefined}
                    aria-describedby={errors.billId ? `${billIdId}-error` : undefined}
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                  />
                )}
                {errors.billId && (
                  <p id={`${billIdId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                    {errors.billId}
                  </p>
                )}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={nameId} style={{ fontSize: 13, fontWeight: 600 }}>
                  {t("payeeNameLabel")} <span aria-hidden="true">*</span>
                </label>
                <input
                  id={nameId}
                  ref={nameRef}
                  value={payeeName}
                  onChange={(e) => setPayeeName(e.target.value)}
                  maxLength={256}
                  aria-required="true"
                  aria-invalid={!!errors.payeeName || undefined}
                  aria-describedby={errors.payeeName ? `${nameId}-error` : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
                {errors.payeeName && (
                  <p id={`${nameId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                    {errors.payeeName}
                  </p>
                )}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={acctId} style={{ fontSize: 13, fontWeight: 600 }}>
                  {t("payeeAccountNoLabel")} <span aria-hidden="true">*</span>
                </label>
                <input
                  id={acctId}
                  ref={acctRef}
                  value={payeeAccountNo}
                  onChange={(e) => setPayeeAccountNo(e.target.value)}
                  maxLength={32}
                  autoComplete="off"
                  aria-required="true"
                  aria-invalid={!!errors.payeeAccountNo || undefined}
                  aria-describedby={errors.payeeAccountNo ? `${acctId}-error` : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
                {errors.payeeAccountNo && (
                  <p id={`${acctId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                    {errors.payeeAccountNo}
                  </p>
                )}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={acctConfirmId} style={{ fontSize: 13, fontWeight: 600 }}>
                  {t("payeeAccountNoConfirmLabel")} <span aria-hidden="true">*</span>
                </label>
                <input
                  id={acctConfirmId}
                  ref={acctConfirmRef}
                  value={payeeAccountNoConfirm}
                  onChange={(e) => setPayeeAccountNoConfirm(e.target.value)}
                  maxLength={32}
                  autoComplete="off"
                  aria-required="true"
                  aria-invalid={!!errors.payeeAccountNoConfirm || undefined}
                  aria-describedby={errors.payeeAccountNoConfirm ? `${acctConfirmId}-error` : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
                {errors.payeeAccountNoConfirm && (
                  <p id={`${acctConfirmId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                    {errors.payeeAccountNoConfirm}
                  </p>
                )}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={ifscId} style={{ fontSize: 13, fontWeight: 600 }}>
                  {t("payeeIfscLabel")} <span aria-hidden="true">*</span>
                </label>
                <input
                  id={ifscId}
                  ref={ifscRef}
                  value={payeeIfsc}
                  onChange={(e) => setPayeeIfsc(e.target.value)}
                  maxLength={11}
                  autoComplete="off"
                  aria-required="true"
                  aria-invalid={!!errors.payeeIfsc || undefined}
                  aria-describedby={errors.payeeIfsc ? `${ifscId}-error` : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, textTransform: "uppercase" }}
                />
                {errors.payeeIfsc && (
                  <p id={`${ifscId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                    {errors.payeeIfsc}
                  </p>
                )}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={amountId} style={{ fontSize: 13, fontWeight: 600 }}>
                  {t("amountLabel")} <span aria-hidden="true">*</span>
                </label>
                <input
                  id={amountId}
                  ref={amountRef}
                  value={amountMinor}
                  onChange={(e) => setAmountMinor(e.target.value)}
                  inputMode="numeric"
                  aria-required="true"
                  aria-invalid={!!errors.amountMinor || undefined}
                  aria-describedby={errors.amountMinor ? `${amountId}-error` : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
                {previewAmount && <span style={{ fontSize: 12, color: "var(--muted, #666)" }}>{previewAmount}</span>}
                {errors.amountMinor && (
                  <p id={`${amountId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                    {errors.amountMinor}
                  </p>
                )}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={purposeId} style={{ fontSize: 13, fontWeight: 600 }}>
                  {t("purposeCodeLabel")} <span aria-hidden="true">*</span>
                </label>
                <input
                  id={purposeId}
                  ref={purposeRef}
                  value={purposeCode}
                  onChange={(e) => setPurposeCode(e.target.value)}
                  maxLength={32}
                  aria-required="true"
                  aria-invalid={!!errors.purposeCode || undefined}
                  aria-describedby={errors.purposeCode ? `${purposeId}-error` : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
                {errors.purposeCode && (
                  <p id={`${purposeId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                    {errors.purposeCode}
                  </p>
                )}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={ddoId} style={{ fontSize: 13, fontWeight: 600 }}>{t("ddoCodeLabel")}</label>
                <input
                  id={ddoId}
                  value={ddoCode}
                  onChange={(e) => setDdoCode(e.target.value)}
                  maxLength={32}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
              </div>
            </div>

            <div>
              <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
                {t("title")}
              </Button>
            </div>

            {message && (
              <p role="status" className="pill good" style={{ width: "fit-content" }}>
                {message}
              </p>
            )}
          </div>
        </Card>

        <ConfirmDialog
          open={confirmOpen}
          title={t("confirmTitle")}
          confirmLabel={t("confirmLabel")}
          danger
          busy={busy}
          errorMessage={dialogError}
          description={
            <>
              {t.rich("confirmDescription", {
                payeeName,
                amount: previewAmount ?? t("amountAboveFallback"),
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </>
          }
          onConfirm={() => void submit()}
          onCancel={() => !busy && setConfirmOpen(false)}
        />
      </form>

      <AdviceStatusLookup prefillAdviceId={lastAdviceId} onModeObserved={onModeObserved} />
    </>
  );
}

/** GET /v1/finance/pfms/payment-status/:adviceId — treasury advice status enquiry. */
function AdviceStatusLookup({
  prefillAdviceId,
  onModeObserved,
}: {
  prefillAdviceId: string | null;
  onModeObserved?: (mode: PfmsMode) => void;
}) {
  const t = useTranslations("pfmsAdviceStatusLookup");
  const [adviceId, setAdviceId] = useState(prefillAdviceId ?? "");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdviceStatusResult | null>(null);
  const idId = useId();
  const errId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!adviceId.trim()) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setBusy(true);
    try {
      const res = await browserJson<{ data: AdviceStatusResult }>(
        `v1/finance/pfms/payment-status/${encodeURIComponent(adviceId.trim())}`,
        { method: "GET" },
      );
      setResult(res.data);
      if (res.data.mode) onModeObserved?.(res.data.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fetchError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("title")} padding>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6, flex: "1 1 240px" }}>
            <label htmlFor={idId} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("adviceIdLabel")} <span aria-hidden="true">*</span>
            </label>
            <input
              id={idId}
              value={adviceId}
              onChange={(e) => setAdviceId(e.target.value)}
              aria-required="true"
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
            {busy ? t("checking") : t("checkStatus")}
          </Button>
        </div>
        {invalid && (
          <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
            {t("invalidMessage")}
          </p>
        )}
        {error && (
          <p role="alert" className="pill bad" style={{ width: "fit-content" }}>
            {error}
          </p>
        )}
        {result && (
          <dl className="fields">
            <div className="fld"><dt className="l">{t("adviceIdLabel")}</dt><dd className="v" style={{ margin: 0 }}>{result.adviceId}</dd></div>
            <div className="fld"><dt className="l">{t("colStatus")}</dt><dd className="v" style={{ margin: 0 }}>{result.status}</dd></div>
            <div className="fld"><dt className="l">{t("colTxnId")}</dt><dd className="v" style={{ margin: 0 }}>{result.pfmsTransactionId}</dd></div>
            <div className="fld"><dt className="l">{t("colUtr")}</dt><dd className="v" style={{ margin: 0 }}>{result.utrNumber}</dd></div>
            <div className="fld"><dt className="l">{t("colProcessedAt")}</dt><dd className="v" style={{ margin: 0 }}>{result.processedAt}</dd></div>
          </dl>
        )}
      </form>
    </Card>
  );
}
