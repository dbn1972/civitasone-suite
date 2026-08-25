"use client";

/**
 * New Budget Estimate (BE).
 * POSTs to the real finance-service endpoint POST /v1/finance/budgets
 * (body: { headId: uuid, fy: "YYYY-YY", beMinor: string }) via the gateway
 * proxy. beMinor is a base-10 integer STRING (paise) -- the backend's
 * createBudgetBody schema is bigint-safe (matches createBillBody.grossMinor's
 * convention) and rejects a raw JSON number outright, since a number can
 * silently lose precision above 2^53 before Zod ever sees it. Same
 * rupees->paise->string conversion as revenue/assessments/
 * AssessmentCreateForm.tsx's rupeesToPaiseString().
 * Heads are loaded from GET /v1/finance/accounts.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../../../../_components/ds";

type AccountRow = { id: string; code?: string; name?: string };

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

function defaultFy(): string {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export default function NewBudgetEstimatePage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [headId, setHeadId] = useState("");
  const [fy, setFy] = useState(defaultFy());
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/finance/accounts?limit=200", { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`Failed to load budget heads (${res.status}).`);
        const json = (await res.json()) as { data?: AccountRow[] } | AccountRow[];
        if (active) setAccounts(Array.isArray(json) ? json : json.data ?? []);
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : "Failed to load budget heads.");
      }
    })();
    return () => { active = false; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      // BUG FIX: beMinor must be sent as a base-10 integer STRING -- the
      // backend's createBudgetBody schema no longer accepts a raw number
      // (see the file-header comment above).
      const beMinor = Math.round(Number(amount || "0") * 100).toString();
      const res = await fetch("/api/proxy/v1/finance/budgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ headId, fy, beMinor }),
      });
      if (!(res.ok || res.status === 202)) throw new Error(await res.text());
      setMessage("Budget estimate submitted.");
      setAmount("");
      router.refresh();
      setTimeout(() => router.push("/finance/budget/formulation"), 700);
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
        title="New Budget Estimate"
        subtitle="Propose a budget estimate (BE) for a major/minor head."
        back="/finance/budget/formulation"
        backLabel="Budget Formulation"
      />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {loadError ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{loadError}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="be-head">Budget head</label>
              <select id="be-head" required value={headId} onChange={(e) => setHeadId(e.target.value)} style={inputStyle}>
                <option value="" disabled>Select a head…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{[a.code, a.name].filter(Boolean).join(" · ") || a.id}</option>
                ))}
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="be-fy">Financial year</label>
              <input id="be-fy" required pattern="\d{4}-\d{2}" placeholder="YYYY-YY" value={fy} onChange={(e) => setFy(e.target.value)} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="be-amt">Budget estimate (₹)</label>
              <input id="be-amt" required type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy || !headId} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? "Saving…" : "Submit estimate"}
          </button>
        </form>
      </div>
    </>
  );
}
