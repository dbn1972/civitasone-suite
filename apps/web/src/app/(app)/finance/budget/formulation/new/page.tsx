"use client";

/**
 * New Budget Estimate (BE).
 * POSTs to the real finance-service endpoint POST /v1/finance/budgets
 * (body: { headId: uuid, fy: "YYYY-YY", beMinor: string }) via the gateway
 * proxy. beMinor is a base-10 integer STRING (paise) -- the backend's
 * createBudgetBody schema is bigint-safe (matches createBillBody.grossMinor's
 * convention) and rejects a raw JSON number outright, since a number can
 * silently lose precision above 2^53 before Zod ever sees it. The
 * rupees->paise conversion is string-based (lib/money's rupeesToMinorString,
 * GAP-FINANCE-BUDGET-FORMULATION-NEW-01) -- never Number(x) * 100.
 * Heads are loaded from GET /v1/finance/accounts and filtered to expenditure
 * heads (GAP-FINANCE-BUDGET-FORMULATION-NEW-02); finance-service rejects a
 * non-expense head on POST regardless (the real control).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, PageHeader } from "../../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

import { budgetableHeads, type AccountRow } from "../../_lib/heads";

const AMOUNT_ERROR = "Enter an amount in rupees greater than 0, with at most 2 decimals (e.g. 1234567.89).";



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
  const [amountError, setAmountError] = useState("");
  const formError = useFormError("budget estimate");
  const previewMinor = rupeesToMinorString(amount);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/finance/accounts?limit=500", { headers: { accept: "application/json" } });
        if (!res.ok) {
          if (active) setLoadError((await formError.fromResponse(res, "load")).message);
          return;
        }
        const json = (await res.json()) as { data?: AccountRow[] } | AccountRow[];
        if (active) setAccounts(budgetableHeads(Array.isArray(json) ? json : json.data ?? []));
      } catch {
        if (active) setLoadError(formError.fromException("load").message);
      }
    })();
    return () => { active = false; };
    // formError.fromResponse/fromException are stable (useCallback'd on a
    // fixed `area` string inside useFormError) even though the wrapping
    // formError object literal isn't, so omitting it here is safe and avoids
    // re-running this load effect every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Exact, string-based rupees -> paise (no float): "1234567.89" -> "123456789";
    // "1.005", "-5", "0", "abc", "1e21" are rejected before any request.
    const beMinor = rupeesToMinorString(amount);
    if (beMinor === null) {
      setAmountError(AMOUNT_ERROR);
      return;
    }
    setAmountError("");
    setBusy(true);
    setMessage("");
    setIsError(false);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/finance/budgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ headId, fy, beMinor }),
      });
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage("Budget estimate submitted.");
      setAmount("");
      router.refresh();
      setTimeout(() => router.push("/finance/budget/formulation"), 700);
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
              {formError.fieldError("headId") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("headId")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="be-fy">Financial year</label>
              <input id="be-fy" required pattern="\d{4}-\d{2}" placeholder="YYYY-YY" value={fy} onChange={(e) => setFy(e.target.value)} style={inputStyle} />
              {formError.fieldError("fy") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("fy")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="be-amt">Budget estimate (₹)</label>
              <input
                id="be-amt"
                required
                type="text"
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                autoComplete="off"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setAmountError(""); }}
                aria-invalid={amountError ? true : undefined}
                aria-describedby="be-amt-hint"
                style={inputStyle}
              />
              <span id="be-amt-hint" style={{ fontSize: 12, color: "var(--mut)" }}>
                {previewMinor !== null ? `Will be recorded as ${formatMoney(BigInt(previewMinor))}` : "Rupees, up to 2 decimals"}
              </span>
              {amountError && (
                <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{amountError}</span>
              )}
              {formError.fieldError("beMinor") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("beMinor")}</span>
              )}
            </div>
          </div>
          <Button type="submit" disabled={busy || !headId} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? "Saving…" : "Submit estimate"}
          </Button>
        </form>
      </div>
    </>
  );
}
