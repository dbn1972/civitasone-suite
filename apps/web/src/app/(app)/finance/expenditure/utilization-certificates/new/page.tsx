"use client";

/**
 * New Utilization Certificate (UC).
 *
 * Wires to the canonical create endpoint POST /v1/finance/utilization-certificates
 * via the gateway proxy. amountMinor is a base-10 integer STRING (paise) --
 * createUCBody is bigint-safe (matches createBillBody.grossMinor's
 * convention) and rejects a raw JSON number, since a number can silently
 * lose precision above 2^53 before Zod ever sees it. The form is a real
 * action with validation + accessible error reporting (not a dead control);
 * failures are surfaced via aria-live.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export default function NewUCPage() {
  const t = useTranslations("expenditureUCNew");
  const router = useRouter();
  const [form, setForm] = useState({ ucNo: "", purpose: "", scheme: "", amount: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const formError = useFormError("utilization certificate");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
    formError.clear();
    try {
      // BUG FIX: amountMinor must be sent as a base-10 integer STRING -- the
      // backend's createUCBody schema no longer accepts a raw number (see
      // the file-header comment above).
      const amountMinor = Math.round(Number(form.amount || "0") * 100).toString();
      const res = await fetch("/api/proxy/v1/finance/utilization-certificates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ucNo: form.ucNo, purpose: form.purpose, scheme: form.scheme || undefined, amountMinor, currency: "INR" }),
      });
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage(t("submitted"));
      router.refresh();
      setTimeout(() => router.push("/finance/expenditure/utilization-certificates"), 700);
    } catch {
      setIsError(true);
      setMessage(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/finance/expenditure/utilization-certificates"
        backLabel={t("backLabel")}
      />
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="uc-no">{t("labelUcNumber")}</label>
              <input id="uc-no" required value={form.ucNo} onChange={(e) => setForm({ ...form, ucNo: e.target.value })} style={inputStyle} />
              {formError.fieldError("ucNo") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("ucNo")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="uc-scheme">{t("labelSchemeGrant")}</label>
              <input id="uc-scheme" value={form.scheme} onChange={(e) => setForm({ ...form, scheme: e.target.value })} style={inputStyle} />
              {formError.fieldError("scheme") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("scheme")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="uc-amt">{t("labelAmountUtilised")}</label>
              <input id="uc-amt" required type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} />
              {formError.fieldError("amountMinor") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("amountMinor")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="uc-purpose">{t("labelPurpose")}</label>
              <input id="uc-purpose" required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} style={inputStyle} />
              {formError.fieldError("purpose") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("purpose")}</span>
              )}
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? t("saving") : t("submit")}
          </button>
        </form>
      </div>
    </>
  );
}
