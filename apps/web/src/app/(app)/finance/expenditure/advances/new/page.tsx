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
import { PageHeader } from "../../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export default function NewAdvancePage() {
  const router = useRouter();
  const [form, setForm] = useState({ advanceNo: "", purpose: "", payee: "", amount: "", dueDate: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const formError = useFormError("advance");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
    formError.clear();
    try {
      // BUG FIX: amountMinor must be sent as a base-10 integer STRING -- the
      // backend's createAdvanceBody schema no longer accepts a raw number
      // (see the file-header comment above).
      const amountMinor = Math.round(Number(form.amount || "0") * 100).toString();
      const res = await fetch("/api/proxy/v1/finance/advances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          advanceNo: form.advanceNo,
          purpose: form.purpose,
          payee: form.payee || undefined,
          amountMinor,
          currency: "INR",
          dueDate: form.dueDate || undefined,
        }),
      });
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage("Advance recorded.");
      router.refresh();
      setTimeout(() => router.push("/finance/expenditure/advances"), 700);
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
        title="New Advance"
        subtitle="Issue an advance to be recovered against actual expenditure."
        back="/finance/expenditure/advances"
        backLabel="Advance Management"
      />
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="adv-no">Advance number</label>
              <input id="adv-no" required value={form.advanceNo} onChange={(e) => setForm({ ...form, advanceNo: e.target.value })} style={inputStyle} />
              {formError.fieldError("advanceNo") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("advanceNo")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="adv-payee">Payee</label>
              <input id="adv-payee" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} style={inputStyle} />
              {formError.fieldError("payee") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("payee")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="adv-amt">Amount (₹)</label>
              <input id="adv-amt" required type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} />
              {formError.fieldError("amountMinor") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("amountMinor")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="adv-due">Recovery due date</label>
              <input id="adv-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} style={inputStyle} />
              {formError.fieldError("dueDate") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("dueDate")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="adv-purpose">Purpose</label>
              <input id="adv-purpose" required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} style={inputStyle} />
              {formError.fieldError("purpose") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("purpose")}</span>
              )}
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? "Saving…" : "Create advance"}
          </button>
        </form>
      </div>
    </>
  );
}
