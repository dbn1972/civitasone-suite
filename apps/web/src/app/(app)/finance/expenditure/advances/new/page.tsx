"use client";

/**
 * New Advance.
 *
 * Wires to the canonical create endpoint POST /v1/finance/advances via the
 * gateway proxy. amountMinor is a base-10 integer STRING (paise) --
 * createAdvanceBody is bigint-safe (matches createBillBody.grossMinor's
 * convention) and rejects a raw JSON number, since a number can silently
 * lose precision above 2^53 before Zod ever sees it. The form is a real
 * action with validation + accessible error reporting (not a dead control).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, PageHeader } from "../../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export default function NewAdvancePage() {
  const t = useTranslations("expenditureAdvancesNew");
  const router = useRouter();
  const [form, setForm] = useState({ advanceNo: "", purpose: "", payee: "", type: "employee", amount: "", dueDate: "", sanctionAuthority: "" });
  const [payeeError, setPayeeError] = useState("");
  const [authorityError, setAuthorityError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const formError = useFormError("advance");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [amountError, setAmountError] = useState("");
  // One idempotency key per logical submission (rotated only after success),
  // so a double click / retry cannot create two advances.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState(false);

  /** Validate, then ask for confirmation -- nothing is sent until the officer confirms. */
  function review(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setIsError(false);
    formError.clear();
    // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-03: an advance is issued TO someone;
    // the register's primary identifier is the payee, so it is not optional.
    if (!form.payee.trim()) {
      setPayeeError(t("errorPayee"));
      return;
    }
    setPayeeError("");
    // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01: the sanctioning authority is recorded with the advance.
    if (form.sanctionAuthority.trim().length < 2) {
      setAuthorityError(t("errorAuthority"));
      return;
    }
    setAuthorityError("");
    if (rupeesToMinorString(form.amount) === null) {
      setAmountError(t("errorAmount"));
      return;
    }
    setAmountError("");
    setConfirmOpen(true);
  }

  async function submit(reason?: string) {
    const amountMinor = rupeesToMinorString(form.amount);
    if (amountMinor === null) return;
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      // amountMinor is a paise STRING built without float math (a bare
      // Number * 100 mis-rounds amounts like 1.005).
      const res = await fetch("/api/proxy/v1/finance/advances", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify({
          advanceNo: form.advanceNo.trim(),
          purpose: form.purpose,
          payee: form.payee.trim(),
          // The API's `type` enum (employee | vendor | other) was never sent,
          // so every advance was silently recorded as "employee"
          // (GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-06).
          type: form.type,
          amountMinor,
          currency: "INR",
          dueDate: form.dueDate || undefined,
          sanctionAuthority: form.sanctionAuthority.trim(),
          reason: (reason ?? "").trim(),
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
      setMessage(t("recorded"));
      router.refresh();
      setTimeout(() => router.push("/finance/expenditure/advances"), 700);
    } catch (caught) {
      setConfirmOpen(false);
      setIsError(true);
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/finance/expenditure/advances"
        backLabel={t("backLabel")}
      />
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card">
        <form onSubmit={review} className="pad" noValidate>
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="adv-no">{t("labelAdvanceNumber")}</label>
              <input id="adv-no" required aria-required="true" maxLength={64} aria-describedby="adv-no-hint" value={form.advanceNo} onChange={(e) => setForm({ ...form, advanceNo: e.target.value })} style={inputStyle} />
              <span id="adv-no-hint" style={{ fontSize: 12, color: "var(--ink2)" }}>{t("hintAdvanceNumber")}</span>
              {formError.fieldError("advanceNo") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("advanceNo")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="adv-payee">{t("labelPayee")}</label>
              <input id="adv-payee" required aria-required="true" maxLength={200} aria-invalid={payeeError ? true : undefined} aria-describedby="adv-payee-help" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} style={inputStyle} />
              <span id="adv-payee-help" style={{ fontSize: 12, color: "var(--ink2)" }}>{t("helpPayee")}</span>
              {payeeError && <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{payeeError}</span>}
              {formError.fieldError("payee") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("payee")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="adv-authority">{t("labelAuthority")}</label>
              <input id="adv-authority" required aria-required="true" maxLength={200} aria-invalid={authorityError ? true : undefined} aria-describedby="adv-authority-help" value={form.sanctionAuthority} onChange={(e) => setForm({ ...form, sanctionAuthority: e.target.value })} style={inputStyle} />
              <span id="adv-authority-help" style={{ fontSize: 12, color: "var(--ink2)" }}>{t("helpAuthority")}</span>
              {authorityError && <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{authorityError}</span>}
              {formError.fieldError("sanctionAuthority") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("sanctionAuthority")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="adv-type">{t("labelType")}</label>
              <select id="adv-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={inputStyle}>
                <option value="employee">{t("typeEmployee")}</option>
                <option value="vendor">{t("typeVendor")}</option>
                <option value="other">{t("typeOther")}</option>
              </select>
              {formError.fieldError("type") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("type")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="adv-amt">{t("labelAmount")}</label>
              <input id="adv-amt" required type="text" inputMode="decimal" autoComplete="off" pattern="\d{1,13}(\.\d{1,2})?" aria-invalid={amountError ? true : undefined} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} />
              {amountError && <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{amountError}</span>}
              {formError.fieldError("amountMinor") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("amountMinor")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="adv-due">{t("labelDueDate")}</label>
              <input id="adv-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} style={inputStyle} />
              {formError.fieldError("dueDate") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("dueDate")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="adv-purpose">{t("labelPurpose")}</label>
              <input id="adv-purpose" required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} style={inputStyle} />
              {formError.fieldError("purpose") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("purpose")}</span>
              )}
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
        description={t("confirmDescription", {
          payee: form.payee.trim() || t("confirmNoPayee"),
          amount: formatMoney(rupeesToMinorString(form.amount) ?? "0"),
          dueDate: form.dueDate ? formatIndianDate(form.dueDate) : t("confirmNoDueDate"),
        })}
        confirmLabel={t("confirmLabel")}
        requireReason
        reasonLabel={t("reasonLabel")}
        minReasonLength={5}
        maxReasonLength={500}
        busy={busy}
        onConfirm={(reason) => { void submit(reason); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
