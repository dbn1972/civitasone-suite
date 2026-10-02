"use client";

/**
 * New sanction (GAP-FINANCE-BUDGET-SANCTIONS-01).
 *
 * "+ New Sanction" used to POST only { reason, status: "pending" } from a
 * one-line confirm -- finance-service's createSanctionBody requires
 * sanctionNo, purpose, headId and amountMinor, so it could never have been
 * accepted. This form collects the real contract:
 *   sanctionNo  -- the sanction order number
 *   purpose     -- the subject of the sanction (shown as "Subject")
 *   headId      -- an EXPENDITURE head from GET /v1/finance/accounts
 *   amountMinor -- paise as a base-10 STRING, converted exactly from rupees
 *                  (lib/money rupeesToMinorString; never Number(x) * 100)
 * The server creates it as pending_approval; a distinct finance_admin must
 * approve it (maker-checker, enforced server-side) before it commits budget.
 * Line items are not part of the backend contract, so none are collected.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, PageHeader } from "../../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import { budgetableHeads, headOptionLabel, type AccountRow } from "../../_lib/heads";
import { validateSanction, type SanctionFormErrors } from "./validateSanction";

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const errStyle = { fontSize: 12, color: "#b91c1c" } as const;
const fieldStyle = { flexDirection: "column", alignItems: "flex-start" } as const;

type LocalErrors = SanctionFormErrors;

export default function NewSanctionPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [sanctionNo, setSanctionNo] = useState("");
  const [purpose, setPurpose] = useState("");
  const [headId, setHeadId] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<LocalErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const formError = useFormError("sanction");
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException are stable (useCallback'd on a fixed area string in useFormError).
  }, []);

  function validate(): { amountMinor: string } | null {
    const result = validateSanction({ sanctionNo, purpose, headId, amount });
    setErrors(result.errors);
    return result.amountMinor !== null ? { amountMinor: result.amountMinor } : null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setIsError(false);
    formError.clear();
    const ok = validate();
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/finance/sanctions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sanctionNo: sanctionNo.trim(),
          purpose: purpose.trim(),
          headId,
          amountMinor: ok.amountMinor,
        }),
      });
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage("Sanction submitted. It now awaits approval by a different finance officer.");
      router.refresh();
      setTimeout(() => router.push("/finance/budget/sanctions"), 900);
    } catch {
      setIsError(true);
      setMessage(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  const fieldErr = (k: keyof LocalErrors, server: string) => errors[k] ?? formError.fieldError(server);

  return (
    <>
      <PageHeader
        title="New Sanction"
        subtitle="Record an administrative & financial sanction against a budget head. A different officer must approve it."
        back="/finance/budget/sanctions"
        backLabel="Sanctions"
      />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {loadError ? (
        <div role="alert" className="banner" style={{ background: "#fef2f2", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{loadError}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad" noValidate>
          <div className="fields">
            <div className="fld" style={fieldStyle}>
              <label className="l" htmlFor="sn-no">Sanction number</label>
              <input id="sn-no" required maxLength={64} value={sanctionNo} onChange={(e) => setSanctionNo(e.target.value)} aria-invalid={fieldErr("sanctionNo", "sanctionNo") ? true : undefined} style={inputStyle} />
              {fieldErr("sanctionNo", "sanctionNo") && <span style={errStyle}>{fieldErr("sanctionNo", "sanctionNo")}</span>}
            </div>
            <div className="fld" style={fieldStyle}>
              <label className="l" htmlFor="sn-purpose">Subject</label>
              <input id="sn-purpose" required maxLength={500} value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-invalid={fieldErr("purpose", "purpose") ? true : undefined} style={inputStyle} />
              {fieldErr("purpose", "purpose") && <span style={errStyle}>{fieldErr("purpose", "purpose")}</span>}
            </div>
            <div className="fld" style={fieldStyle}>
              <label className="l" htmlFor="sn-head">Budget head</label>
              <select id="sn-head" required value={headId} onChange={(e) => setHeadId(e.target.value)} aria-invalid={fieldErr("headId", "headId") ? true : undefined} style={inputStyle}>
                <option value="" disabled>Select a head…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{headOptionLabel(a)}</option>
                ))}
              </select>
              {fieldErr("headId", "headId") && <span style={errStyle}>{fieldErr("headId", "headId")}</span>}
            </div>
            <div className="fld" style={fieldStyle}>
              <label className="l" htmlFor="sn-amt">Amount (₹)</label>
              <input id="sn-amt" required type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={fieldErr("amount", "amountMinor") ? true : undefined} aria-describedby="sn-amt-hint" style={inputStyle} />
              <span id="sn-amt-hint" style={{ fontSize: 12, color: "var(--mut)" }}>
                {previewMinor !== null ? `Will be recorded as ${formatMoney(BigInt(previewMinor))}` : "Rupees, up to 2 decimals"}
              </span>
              {fieldErr("amount", "amountMinor") && <span role="alert" style={errStyle}>{fieldErr("amount", "amountMinor")}</span>}
            </div>
          </div>
          <Button type="submit" disabled={busy} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? "Submitting…" : "Submit sanction"}
          </Button>
        </form>
      </div>
    </>
  );
}
