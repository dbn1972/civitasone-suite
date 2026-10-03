"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "../../../../_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { formatIndianDate } from "@/lib/formatters";

/** NSDL provisional receipt number: exactly 15 digits. */
export const RECEIPT_RE = /^\d{15}$/;

/** Today in IST as YYYY-MM-DD (filing dates are Indian calendar dates; the server rejects a future date). */
function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

type Props = {
  fy: string;
  quarter: string;
  /** Latest recorded revision for this quarter, or null when nothing is filed yet. */
  currentRevision: number | null;
};

/**
 * GAP-PAYROLL-RETURNS-01: record that a quarter's e-TDS statement was FILED
 * (date + the 15-digit provisional receipt number NSDL issued). A quarter is
 * shown as Filed only once this exists -- reconciliation with TRACES alone
 * never makes it "filed". There is no NSDL integration: filing happens on the
 * TIN-NSDL portal and this records it. When a filing already exists the same
 * form records a correction statement as the next revision.
 */
export function RecordFilingForm({ fy, quarter, currentRevision }: Props) {
  const t = useTranslations("recordFilingForm");
  const router = useRouter();
  const [filedOn, setFiledOn] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<{ filedOn?: boolean; receiptNo?: boolean }>({});
  const dateField = useId();
  const receiptField = useId();
  const noteField = useId();
  const errId = useId();
  const revision = currentRevision === null ? 0 : currentRevision + 1;
  const today = todayIst();

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const bad = { filedOn: !filedOn || filedOn > today, receiptNo: !RECEIPT_RE.test(receiptNo.trim()) };
    setInvalid(bad);
    if (bad.filedOn || bad.receiptNo) {
      setError(bad.filedOn ? t("dateError") : t("receiptError"));
      document.getElementById(bad.filedOn ? dateField : receiptField)?.focus();
      return;
    }
    setConfirmOpen(true);
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch("v1/payroll/statutory/returns/filings", {
        method: "POST",
        body: JSON.stringify({
          formType: "24Q", fy, quarter, filedOn, receiptNo: receiptNo.trim(), revision,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        if (code === "RECEIPT_ALREADY_RECORDED") throw new Error(t("receiptTakenError"));
        if (code === "FILING_ALREADY_RECORDED") throw new Error(t("alreadyRecordedError"));
        throw new Error(await errorMessageFromResponse(res));
      }
      setConfirmOpen(false);
      setMessage(t("savedMessage", { quarter, fy }));
      setFiledOn("");
      setReceiptNo("");
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;
  return (
    <form onSubmit={openConfirm} noValidate style={{ marginTop: 14 }} aria-label={revision === 0 ? t("title") : t("titleCorrection", { revision })}>
      <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>{revision === 0 ? t("title") : t("titleCorrection", { revision })}</h3>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink2)" }}>{t("help")}</p>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={dateField} style={{ fontSize: 13, fontWeight: 600 }}>{t("filedOnLabel")} <span aria-hidden="true">*</span></label>
          <input
            id={dateField}
            type="date"
            max={today}
            value={filedOn}
            onChange={(e) => { setFiledOn(e.target.value); setInvalid((p) => ({ ...p, filedOn: false })); }}
            aria-required="true"
            aria-invalid={invalid.filedOn || undefined}
            aria-describedby={invalid.filedOn ? errId : undefined}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={receiptField} style={{ fontSize: 13, fontWeight: 600 }}>{t("receiptLabel")} <span aria-hidden="true">*</span></label>
          <input
            id={receiptField}
            inputMode="numeric"
            maxLength={15}
            autoComplete="off"
            value={receiptNo}
            onChange={(e) => { setReceiptNo(e.target.value.replace(/\s/g, "")); setInvalid((p) => ({ ...p, receiptNo: false })); }}
            aria-required="true"
            aria-invalid={invalid.receiptNo || undefined}
            aria-describedby={invalid.receiptNo ? errId : undefined}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor={noteField} style={{ fontSize: 13, fontWeight: 600 }}>{t("noteLabel")}</label>
          <input id={noteField} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Button type="submit" disabled={busy} style={{ minHeight: 44 }}>{t("saveBtn")}</Button>
      </div>
      {error && !confirmOpen && <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content", marginTop: 10 }}>{error}</p>}
      {message && <p role="status" className="pill good" style={{ width: "fit-content", marginTop: 10 }}>{message}</p>}
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        description={t("confirmDescription", { quarter, fy, date: filedOn ? formatIndianDate(filedOn) : "", receipt: receiptNo.trim() })}
        onConfirm={() => void save()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
