"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { EmployeePicker } from "../../../../_components/EmployeePicker";
import { postWithErrorCode } from "../_lib/postWithErrorCode";
import { formatMoney, formatPeriod } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { REIMBURSEMENT_CATEGORIES, reimbursementCategoryKey, type ReimbursementCategory } from "@/lib/payroll/reimbursementCategories";
import { receiptRequired } from "@/lib/payroll/receiptRules";
import { ReceiptUpload, type Receipt } from "./ReceiptUpload";

/**
 * GAP-PAYROLL-REIMBURSEMENTS-01: who the claim is for.
 *  - "admin": payroll/HR staff filing on someone's behalf pick the employee
 *    by name (EntityPicker), never by typed UUID.
 *  - "self": a self-service employee files for THEMSELVES -- their own
 *    profile is shown read-only and cannot be changed (the server enforces
 *    the same, resolving the caller's own employee id).
 */
export type ClaimSubject = { mode: "admin" } | { mode: "self"; employeeId: string; label: string };

type InvalidField = "employeeId" | "amount" | "period" | "receipts" | null;

const fieldStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

export function CreateReimbursementForm({ subject }: { subject: ClaimSubject }) {
  const t = useTranslations("createReimbursementForm");
  const router = useRouter();
  const [pickedEmployeeId, setPickedEmployeeId] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [category, setCategory] = useState<ReimbursementCategory>("medical");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("");
  const [billDate, setBillDate] = useState("");
  const [billRef, setBillRef] = useState("");
  // GAP-PAYROLL-REIMBURSEMENTS-03: private receipt keys + an upload-in-flight flag.
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [invalidField, setInvalidField] = useState<InvalidField>(null);

  const empId = useId();
  const catId = useId();
  const amtId = useId();
  const periodId = useId();
  const dateId = useId();
  const refId = useId();
  const errId = useId();
  const amtRef = useRef<HTMLInputElement>(null);
  const periodRef = useRef<HTMLInputElement>(null);

  const employeeId = subject.mode === "self" ? subject.employeeId : pickedEmployeeId;
  const employeeLabel = subject.mode === "self" ? subject.label : pickedName ?? pickedEmployeeId ?? "";
  const amountMinor = rupeesToMinorString(amount);
  const isInvalid = (f: Exclude<InvalidField, null>) => tone === "bad" && invalidField === f;
  const categoryLabel = (c: string) => {
    const key = reimbursementCategoryKey(c);
    return key ? t(key) : c;
  };

  function fail(field: Exclude<InvalidField, null>, key: string, focus?: () => void) {
    setTone("bad");
    setInvalidField(field);
    setMessage(t(key));
    focus?.();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    if (!employeeId) return fail("employeeId", "employeeIdRequiredError", () => document.getElementById(empId)?.focus());
    // GAP-PAYROLL-REIMBURSEMENTS-04: decimal-string -> paise (no parseFloat * 100).
    if (amountMinor === null || BigInt(amountMinor) > BigInt(Number.MAX_SAFE_INTEGER)) {
      return fail("amount", "amountRequiredError", () => amtRef.current?.focus());
    }
    // GAP-PAYROLL-REIMBURSEMENTS-04: a real month (2026-13 used to pass).
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period.trim())) return fail("period", "periodFormatError", () => periodRef.current?.focus());
    // GAP-PAYROLL-REIMBURSEMENTS-03: medical / LTA / travel claims need a receipt.
    if (uploading) return fail("receipts", "receiptUploadingError");
    if (receiptRequired(category) && receipts.length === 0) return fail("receipts", "receiptRequiredError");
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createReimbursement() {
    if (!employeeId || amountMinor === null) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      // CQRS: 202 { id, status: "accepted" } -- the old `res.data.amount_minor`
      // read a field the response never carries and threw on every success.
      await postWithErrorCode<{ id: string; status: string }>("v1/payroll/reimbursements", {
          employeeId,
          category,
          amountMinor: Number(amountMinor),
          billDate: billDate.trim() || undefined,
          billRef: billRef.trim() || undefined,
          period: period.trim(),
          attachmentKeys: receipts.length > 0 ? receipts.map((r) => r.key) : undefined,
        }, {
        RECEIPT_REQUIRED: t("receiptRequiredError"),
        RECEIPT_KEY_INVALID: t("receiptKeyInvalidError"),
        RECEIPT_FILE_INVALID: t("receiptFileInvalidError"),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t("submittedMessage", { amount: formatMoney(amountMinor) }));
      if (subject.mode === "admin") { setPickedEmployeeId(null); setPickedName(null); }
      setAmount("");
      setBillRef("");
      setReceipts([]);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("employeeLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              {subject.mode === "self" ? (
                <input id={empId} value={subject.label} readOnly aria-readonly="true" style={{ ...fieldStyle, background: "var(--panel)" }} />
              ) : (
                <EmployeePicker
                  id={empId}
                  value={pickedEmployeeId}
                  onChange={(id, option) => { setPickedEmployeeId(id); setPickedName(option?.label ?? null); }}
                  clearable
                />
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={catId} style={{ fontSize: 13, fontWeight: 600 }}>{t("categoryLabel")}</label>
              <select
                id={catId}
                value={category}
                onChange={(e) => setCategory(e.target.value as ReimbursementCategory)}
                style={{ ...fieldStyle, background: "var(--bg, #fff)" }}
              >
                {REIMBURSEMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{categoryLabel(c)}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amtId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("amountLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={amtId}
                ref={amtRef}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-required="true"
                aria-invalid={isInvalid("amount") || undefined}
                aria-describedby={isInvalid("amount") ? errId : undefined}
                style={fieldStyle}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={periodId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("periodLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={periodId}
                ref={periodRef}
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                aria-required="true"
                aria-invalid={isInvalid("period") || undefined}
                aria-describedby={isInvalid("period") ? errId : undefined}
                style={fieldStyle}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dateId} style={{ fontSize: 13, fontWeight: 600 }}>{t("billDateLabel")}</label>
              <input id={dateId} type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} style={fieldStyle} />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={refId} style={{ fontSize: 13, fontWeight: 600 }}>{t("billRefLabel")}</label>
              <input id={refId} value={billRef} onChange={(e) => setBillRef(e.target.value)} maxLength={128} style={fieldStyle} />
            </div>
          </div>

          <div>
            <ReceiptUpload receipts={receipts} onChange={setReceipts} onBusyChange={setUploading} />
            {receiptRequired(category) && (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--mut)" }}>{t("receiptRequiredHint", { category: categoryLabel(category) })}</p>
            )}
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy || uploading}>
              {t("submitClaimBtn")}
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
          category: categoryLabel(category),
          amount: formatMoney(amountMinor ?? 0),
          employee: employeeLabel,
          period: formatPeriod(period),
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void createReimbursement()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
