"use client";

/**
 * New Utilization Certificate (UC).
 *
 * Wires to the canonical create endpoint POST /v1/finance/utilization-certificates
 * via the gateway proxy. NOTE (handoff): finance-service currently exposes only
 * GET /v1/finance/utilization-certificates — there is NO create route yet, so
 * this submit will return an error until the backend command is added. The form
 * is a real action with validation + accessible error reporting (not a dead
 * control); the failure is surfaced via aria-live.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../../../../_components/ds";

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export default function NewUCPage() {
  const router = useRouter();
  const [form, setForm] = useState({ ucNo: "", purpose: "", scheme: "", amount: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const amountMinor = Math.round(Number(form.amount || "0") * 100);
      const res = await fetch("/api/proxy/v1/finance/utilization-certificates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ucNo: form.ucNo, purpose: form.purpose, scheme: form.scheme || undefined, amountMinor, currency: "INR" }),
      });
      if (!(res.ok || res.status === 202)) throw new Error(await res.text());
      setMessage("Utilization certificate submitted.");
      router.refresh();
      setTimeout(() => router.push("/finance/expenditure/utilization-certificates"), 700);
    } catch (e) {
      setIsError(true);
      setMessage(e instanceof Error ? e.message : "Submit failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New Utilization Certificate"
        subtitle="Submit a UC for grant / scheme expenditure."
        back="/finance/expenditure/utilization-certificates"
        backLabel="Utilization Certificates"
      />
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="uc-no">UC number</label>
              <input id="uc-no" required value={form.ucNo} onChange={(e) => setForm({ ...form, ucNo: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="uc-scheme">Scheme / grant</label>
              <input id="uc-scheme" value={form.scheme} onChange={(e) => setForm({ ...form, scheme: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="uc-amt">Amount utilised (₹)</label>
              <input id="uc-amt" required type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="uc-purpose">Purpose</label>
              <input id="uc-purpose" required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? "Saving…" : "Submit UC"}
          </button>
        </form>
      </div>
    </>
  );
}
