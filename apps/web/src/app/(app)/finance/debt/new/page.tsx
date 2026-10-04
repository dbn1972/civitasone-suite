"use client";

/**
 * New loan / debt instrument (GAP-FINANCE-DEBT-01). finance-service builds the
 * reducing-balance EMI schedule from these terms; the principal is sent as exact
 * paise (string), the rate as whole basis points.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, PageHeader } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { errorCodeFromResponse } from "@/lib/api/browserClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { parseDebtForm, type DebtFormErrors, type DebtFormValues } from "../debtForm";

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const EMPTY: DebtFormValues = { instrument: "", source: "", lender: "", principal: "", ratePct: "", tenureMonths: "", firstEmiDate: "" };

export default function NewDebtPage() {
  const t = useTranslations("financeDebtNew");
  const router = useRouter();
  const [form, setForm] = useState<DebtFormValues>(EMPTY);
  const [errors, setErrors] = useState<DebtFormErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const formError = useFormError("loan");
  const parsed = parseDebtForm(form);

  function review(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setIsError(false);
    formError.clear();
    if (!parsed.ok) { setErrors(parsed.errors); return; }
    setErrors({});
    setConfirmOpen(true);
  }

  async function submit() {
    if (!parsed.ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/finance/debt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.body),
      });
      setConfirmOpen(false);
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        const code = await errorCodeFromResponse(res);
        if (code && code.startsWith("GL_HEAD")) { setMessage(t("glNotConfigured")); return; }
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setDone(true);
      setMessage(t("recorded"));
      router.refresh();
      setTimeout(() => router.push("/finance/debt"), 700);
    } catch (caught) {
      setConfirmOpen(false);
      setIsError(true);
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const err = (k: keyof DebtFormErrors, serverField: string) => {
    const local = errors[k];
    const server = formError.fieldError(serverField);
    return local ? <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{t(`error.${local}`)}</span>
      : server ? <span style={{ fontSize: 12, color: "#b91c1c" }}>{server}</span> : null;
  };

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/finance/debt" backLabel={t("backLabel")} />
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card">
        <form onSubmit={review} className="pad" noValidate>
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="debt-instrument">{t("labelInstrument")}</label>
              <input id="debt-instrument" required maxLength={200} value={form.instrument} onChange={(e) => setForm({ ...form, instrument: e.target.value })} style={inputStyle} />
              {err("instrument", "instrument")}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="debt-source">{t("labelSource")}</label>
              <select id="debt-source" required value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} style={inputStyle}>
                <option value="">{t("sourcePlaceholder")}</option>
                <option value="rbi">{t("sourceRbi")}</option>
                <option value="market">{t("sourceMarket")}</option>
                <option value="central_govt">{t("sourceCentralGovt")}</option>
              </select>
              {err("source", "source")}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="debt-lender">{t("labelLender")}</label>
              <input id="debt-lender" required maxLength={200} value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} style={inputStyle} />
              {err("lender", "lender")}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="debt-principal">{t("labelPrincipal")}</label>
              <input id="debt-principal" required type="text" inputMode="decimal" autoComplete="off" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} style={inputStyle} />
              {err("principal", "principalMinor")}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="debt-rate">{t("labelRate")}</label>
              <input id="debt-rate" required type="text" inputMode="decimal" autoComplete="off" value={form.ratePct} onChange={(e) => setForm({ ...form, ratePct: e.target.value })} style={inputStyle} />
              {err("rate", "interestRateBps")}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="debt-tenure">{t("labelTenure")}</label>
              <input id="debt-tenure" required type="text" inputMode="numeric" autoComplete="off" value={form.tenureMonths} onChange={(e) => setForm({ ...form, tenureMonths: e.target.value })} style={inputStyle} />
              {err("tenure", "tenureMonths")}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="debt-first">{t("labelFirstEmi")}</label>
              <input id="debt-first" required type="date" value={form.firstEmiDate} onChange={(e) => setForm({ ...form, firstEmiDate: e.target.value })} style={inputStyle} />
              {err("firstEmi", "firstEmiDate")}
            </div>
          </div>
          <Button type="submit" disabled={busy || done} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? t("saving") : t("submit")}
          </Button>
        </form>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        description={parsed.ok ? t("confirmDescription", {
          instrument: parsed.body.instrument, lender: parsed.body.lender, amount: formatMoney(parsed.body.principalMinor),
          rate: (parsed.body.interestRateBps / 100).toFixed(2), months: parsed.body.tenureMonths, first: formatIndianDate(parsed.body.firstEmiDate),
        }) : ""}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        onConfirm={() => { void submit(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
