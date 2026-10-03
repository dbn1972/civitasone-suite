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
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, PageHeader } from "../../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import { currentFinancialYear, isValidFinancialYearLabel } from "@/lib/fiscalYear";

import { budgetableHeads, headOptionLabel, type AccountRow } from "../../_lib/heads";

const AMOUNT_ERROR = "Enter an amount in rupees greater than 0, with at most 2 decimals (e.g. 1234567.89).";
const FY_ERROR = "Enter a valid financial year, e.g. 2026-27 (the second year must follow the first).";

/** GET /v1/finance/accounts page size; a response this full may be truncated (GAP-FINANCE-BUDGET-FORMULATION-NEW-05). */
const HEADS_LIMIT = 500;
/** How long the success message stays up before the automatic return to the list. */
const REDIRECT_DELAY_MS = 2500;

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export default function NewBudgetEstimatePage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [headId, setHeadId] = useState("");
  // GAP-FINANCE-BUDGET-FORMULATION-NEW-06: IST-correct current FY from the shared helper.
  const [fy, setFy] = useState(() => currentFinancialYear());
  const [fyError, setFyError] = useState("");
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [headsTruncated, setHeadsTruncated] = useState(false);
  const [confirmMinor, setConfirmMinor] = useState<string | null>(null);
  // GAP-FINANCE-BUDGET-FORMULATION-NEW-04: one key per attempt, reused on a retry
  // of the same proposal and rotated only after a successful save.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  // Editing head, FY or amount makes it a different proposal -> a different key
  // (a retry of the SAME proposal keeps its key).
  const rotateKey = () => setIdempotencyKey(crypto.randomUUID());
  const inFlight = useRef(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [amountError, setAmountError] = useState("");
  const formError = useFormError("budget estimate");
  const previewMinor = rupeesToMinorString(amount);

  useEffect(() => () => { if (redirectTimer.current) clearTimeout(redirectTimer.current); }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/finance/accounts?limit=${HEADS_LIMIT}`, { headers: { accept: "application/json" } });
        if (!res.ok) {
          if (active) setLoadError((await formError.fromResponse(res, "load")).message);
          return;
        }
        const json = (await res.json()) as { data?: AccountRow[] } | AccountRow[];
        const rows = Array.isArray(json) ? json : json.data ?? [];
        if (active) {
          setAccounts(budgetableHeads(rows));
          setHeadsTruncated(rows.length >= HEADS_LIMIT);
        }
      } catch (caught) {
        if (active) setLoadError(formError.fromException("load", caught).message);
      } finally {
        if (active) setAccountsLoading(false);
      }
    })();
    return () => { active = false; };
    // formError.fromResponse/fromException are stable (useCallback'd on a
    // fixed `area` string inside useFormError) even though the wrapping
    // formError object literal isn't, so omitting it here is safe and avoids
    // re-running this load effect every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, []);

  /** Validate, then ask for confirmation -- no request is sent from the form submit itself. */
  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Exact, string-based rupees -> paise (no float): "1234567.89" -> "123456789";
    // "1.005", "-5", "0", "abc", "1e21" are rejected before any request.
    const beMinor = rupeesToMinorString(amount);
    if (beMinor === null) {
      setAmountError(AMOUNT_ERROR);
      return;
    }
    setAmountError("");
    if (!isValidFinancialYearLabel(fy)) {
      setFyError(FY_ERROR);
      return;
    }
    setFyError("");
    setConfirmMinor(beMinor);
  }

  async function confirmSubmit() {
    const beMinor = confirmMinor;
    if (beMinor === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setIsError(false);
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/finance/budgets", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify({ headId, fy, beMinor }),
      });
      setConfirmMinor(null);
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setSaved(true);
      setMessage("Budget estimate submitted.");
      setAmount("");
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
      // Long enough to read; the link below goes there immediately.
      redirectTimer.current = setTimeout(() => router.push(listHref), REDIRECT_DELAY_MS);
    } catch (caught) {
      setConfirmMinor(null);
      setIsError(true);
      setMessage(formError.fromException("save", caught).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const selectedHead = accounts.find((a) => a.id === headId);
  // The new estimate is for `fy`, which may not be the list's default FY.
  const listHref = `/finance/budget/formulation?fy=${encodeURIComponent(fy)}`;

  return (
    <>
      <PageHeader
        title="New Budget Estimate"
        subtitle="Propose a budget estimate (BE) for a major/minor head."
        back="/finance/budget/formulation"
        backLabel="Budget Formulation"
      />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}
          {saved && !isError ? <> <a href={listHref}>View in Budget Formulation</a></> : null}
        </div>
      ) : null}
      {loadError ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{loadError}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="be-head">Budget head</label>
              <select id="be-head" required value={headId} onChange={(e) => { setHeadId(e.target.value); rotateKey(); }} disabled={accountsLoading} aria-busy={accountsLoading} style={inputStyle}>
                <option value="" disabled>{accountsLoading ? "Loading heads…" : "Select a head…"}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{headOptionLabel(a)}</option>
                ))}
              </select>
              {headsTruncated && (
                <span role="note" style={{ fontSize: 12, color: "var(--mut)" }}>
                  Showing the first {HEADS_LIMIT} heads — the list may be incomplete. Ask an administrator if the head you need is missing.
                </span>
              )}
              {formError.fieldError("headId") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{formError.fieldError("headId")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="be-fy">Financial year</label>
              <input id="be-fy" required pattern="\d{4}-\d{2}" placeholder="YYYY-YY" value={fy} onChange={(e) => { setFy(e.target.value); setFyError(""); rotateKey(); }} aria-invalid={fyError ? true : undefined} style={inputStyle} />
              {fyError && (
                <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{fyError}</span>
              )}
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
                onChange={(e) => { setAmount(e.target.value); setAmountError(""); rotateKey(); }}
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
      {/* GAP-FINANCE-BUDGET-FORMULATION-NEW-03: a budget estimate is not casually
          undone, so it is confirmed first. Confirm-only: the create endpoint takes
          no reason, so none is collected. */}
      <ConfirmDialog
        open={confirmMinor !== null}
        title="Submit budget estimate?"
        description={
          confirmMinor !== null
            ? `Propose a Budget Estimate of ${formatMoney(BigInt(confirmMinor))} for ${selectedHead ? headOptionLabel(selectedHead) : "the selected head"}, FY ${fy}.`
            : undefined
        }
        confirmLabel="Confirm and submit"
        busy={busy}
        onConfirm={() => { void confirmSubmit(); }}
        onCancel={() => { if (!busy) setConfirmMinor(null); }}
      />
    </>
  );
}
