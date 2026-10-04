"use client";

/**
 * GAP-FINANCE-TREASURY-CHEQUES-03: issue a cheque / demand draft.
 * POST /v1/finance/instruments (finance_officer / finance_admin / super_admin).
 * The amount is entered in rupees and converted to integer paise without float
 * math; a fresh idempotency key is used per logical submission (the server is
 * also idempotent on type + number and answers 409 when the same number is
 * re-issued with different terms).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { issueChequePayload, validateIssueCheque, type IssueChequeErrors } from "./issueCheque";

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const errStyle = { fontSize: 12, color: "#b91c1c" } as const;

/** Today's calendar date in IST (YYYY-MM-DD). */
function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function IssueChequeForm() {
  const t = useTranslations("financeChequesNew");
  const router = useRouter();
  const formError = useFormError("cheque");
  const [form, setForm] = useState({ instrumentType: "cheque", instrumentNo: "", bankName: "", payee: "", amount: "", issueDate: "" });
  const [errors, setErrors] = useState<IssueChequeErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [done, setDone] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const errText = (e: string | undefined): string | undefined =>
    e === undefined ? undefined : e === "required" ? t("errRequired") : e === "amount" ? t("errAmount") : e === "future" ? t("errFuture") : t("errDate");

  function review(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    formError.clear();
    const found = validateIssueCheque(form, todayIst());
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setConfirmOpen(true);
  }

  async function submit() {
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch("/api/proxy/v1/finance/instruments", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify(issueChequePayload(form)),
      });
      setConfirmOpen(false);
      if (!res.ok) {
        setIsError(true);
        setMessage((await formError.fromResponse(res, res.status === 409 ? "conflict" : "save")).message);
        return;
      }
      setDone(true);
      setIdempotencyKey(crypto.randomUUID());
      setMessage(t("recorded"));
      router.refresh();
      setTimeout(() => router.push("/finance/treasury/cheques"), 700);
    } catch (caught) {
      setConfirmOpen(false);
      setIsError(true);
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string, label: string, input: React.ReactNode, err?: string) => (
    <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
      <label className="l" htmlFor={id}>{label}</label>
      {input}
      {err ? <span role="alert" style={errStyle}>{err}</span> : null}
    </div>
  );

  return (
    <>
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card">
        <form onSubmit={review} className="pad" noValidate>
          <div className="fields">
            {field("chq-type", t("labelType"), (
              <select id="chq-type" value={form.instrumentType} onChange={(e) => setForm({ ...form, instrumentType: e.target.value })} style={inputStyle}>
                <option value="cheque">{t("typeCheque")}</option>
                <option value="dd">{t("typeDd")}</option>
              </select>
            ))}
            {field("chq-no", t("labelNumber"), (
              <input id="chq-no" required maxLength={64} aria-invalid={errors.instrumentNo ? true : undefined} value={form.instrumentNo} onChange={(e) => setForm({ ...form, instrumentNo: e.target.value })} style={inputStyle} />
            ), errText(errors.instrumentNo))}
            {field("chq-bank", t("labelBank"), (
              <input id="chq-bank" required maxLength={200} aria-invalid={errors.bankName ? true : undefined} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} style={inputStyle} />
            ), errText(errors.bankName))}
            {field("chq-payee", t("labelPayee"), (
              <input id="chq-payee" required maxLength={200} aria-invalid={errors.payee ? true : undefined} value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} style={inputStyle} />
            ), errText(errors.payee))}
            {field("chq-amt", t("labelAmount"), (
              <input id="chq-amt" required type="text" inputMode="decimal" autoComplete="off" aria-invalid={errors.amount ? true : undefined} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} />
            ), errText(errors.amount) ?? formError.fieldError("amountMinor"))}
            {field("chq-date", t("labelIssueDate"), (
              <input id="chq-date" type="date" max={todayIst()} aria-invalid={errors.issueDate ? true : undefined} value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} style={inputStyle} />
            ), errText(errors.issueDate))}
          </div>
          <Button type="submit" disabled={busy || done} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? t("saving") : t("submit")}
          </Button>
        </form>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        description={t("confirmDescription", {
          payee: form.payee.trim(),
          amount: formatMoney(rupeesToMinorString(form.amount) ?? "0"),
          number: form.instrumentNo.trim(),
        })}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        onConfirm={() => { void submit(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
