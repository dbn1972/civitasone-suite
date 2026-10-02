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
import { Button, ConfirmDialog, PageHeader } from "../../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export default function NewUCPage() {
  const t = useTranslations("expenditureUCNew");
  const router = useRouter();
  const [form, setForm] = useState({ ucNo: "", purpose: "", scheme: "", grantRef: "", periodFrom: "", periodTo: "", amount: "" });
  const [declared, setDeclared] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  // One idempotency key per logical submission (rotated after success).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const formError = useFormError("utilization certificate");

  /** Validate (declaration, amount, period order), then ask for confirmation. Nothing is sent before that. */
  function review(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setIsError(false);
    formError.clear();
    const next: Record<string, string> = {};
    if (rupeesToMinorString(form.amount) === null) next.amount = t("errorAmount");
    if (form.periodFrom && form.periodTo && form.periodFrom > form.periodTo) next.period = t("errorPeriodOrder");
    if (!declared) next.declaration = t("errorDeclaration");
    setErrors(next);
    if (Object.keys(next).length === 0) setConfirmOpen(true); // ux-001-ok: form validation, not a fetch result
  }

  async function submit() {
    const amountMinor = rupeesToMinorString(form.amount);
    if (amountMinor === null) return;
    setBusy(true);
    try {
      // amountMinor is a paise STRING built without float math.
      const res = await fetch("/api/proxy/v1/finance/utilization-certificates", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify({
          ucNo: form.ucNo,
          purpose: form.purpose,
          scheme: form.scheme || undefined,
          grantRef: form.grantRef || undefined,
          periodFrom: form.periodFrom || undefined,
          periodTo: form.periodTo || undefined,
          amountMinor,
          currency: "INR",
        }),
      });
      setConfirmOpen(false);
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setDone(true);
      setIdempotencyKey(crypto.randomUUID());
      setMessage(t("submitted"));
      router.refresh();
      setTimeout(() => router.push("/finance/expenditure/utilization-certificates"), 700);
    } catch {
      setConfirmOpen(false);
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
        <form onSubmit={review} className="pad" noValidate>
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
              <label className="l" htmlFor="uc-grant">{t("labelGrantRef")}</label>
              <input id="uc-grant" value={form.grantRef} onChange={(e) => setForm({ ...form, grantRef: e.target.value })} style={inputStyle} />
              {formError.fieldError("grantRef") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("grantRef")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="uc-from">{t("labelPeriodFrom")}</label>
              <input id="uc-from" type="date" value={form.periodFrom} onChange={(e) => setForm({ ...form, periodFrom: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="uc-to">{t("labelPeriodTo")}</label>
              <input id="uc-to" type="date" value={form.periodTo} onChange={(e) => setForm({ ...form, periodTo: e.target.value })} style={inputStyle} aria-invalid={errors.period ? true : undefined} />
              {errors.period && <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{errors.period}</span>}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="uc-amt">{t("labelAmountUtilised")}</label>
              <input id="uc-amt" required type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} />
              {errors.amount && <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{errors.amount}</span>}
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
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input id="uc-declaration" type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} aria-invalid={errors.declaration ? true : undefined} />
                <span>{t("declaration")}</span>
              </label>
              {errors.declaration && <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{errors.declaration}</span>}
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
        description={t("confirmDescription", { ucNo: form.ucNo, amount: formatMoney(rupeesToMinorString(form.amount) ?? "0") })}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        onConfirm={() => { void submit(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
