"use client";

/**
 * GAP-FINANCE-BUDGET-DEMAND-GRANTS-04: edit the head-wise split of a draft demand.
 * PUT /v1/finance/budgets/demand-grants/:id/lines (finance_officer / finance_admin / super_admin).
 * The split replaces the previous one atomically and must total the demand amount; both the
 * form and the server enforce it.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { formatMoney } from "@/lib/formatters";
import { checkLines, type LineDraft } from "./demandLinesForm";
import type { DemandLine, MajorHeadOption } from "./demandDetail";

const inputStyle = { padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

function minorToRupeesInput(minor: string): string {
  const n = BigInt(minor);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}

const REASON_COPY: Record<string, string> = {
  empty: "Add at least one head.",
  head: "Choose a major head for every row.",
  amount: "Enter a positive amount in rupees (at most 2 decimals) for every row.",
  duplicate: "Each head can appear only once.",
  mismatch: "The head-wise amounts must add up to the demand amount.",
};

export function DemandLinesEditor({
  demandId, demandAmountMinor, lines, heads,
}: { demandId: string; demandAmountMinor: string; lines: DemandLine[]; heads: MajorHeadOption[] }) {
  const router = useRouter();
  const formError = useFormError("demand");
  const [rows, setRows] = useState<LineDraft[]>(
    lines.length > 0 ? lines.map((l) => ({ headCode: l.headCode, amount: minorToRupeesInput(l.amountMinor) })) : [{ headCode: "", amount: "" }],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const check = checkLines(rows, demandAmountMinor);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    formError.clear();
    if (!check.ok) { setIsError(true); setMessage(REASON_COPY[check.reason] ?? ""); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/finance/budgets/demand-grants/${encodeURIComponent(demandId)}/lines`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ lines: check.lines }),
      });
      if (!res.ok) {
        setIsError(true);
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setIsError(false);
      setMessage("Head-wise lines saved. They appear here once processed.");
      router.refresh();
    } catch {
      setIsError(true);
      setMessage(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate aria-label="Edit head-wise lines">
      {message ? <p role={isError ? "alert" : "status"} style={{ fontSize: 13, color: isError ? "#b91c1c" : "inherit" }}>{message}</p> : null}
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select aria-label={`Major head, row ${i + 1}`} value={r.headCode} style={{ ...inputStyle, minWidth: 220 }}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, headCode: e.target.value } : x)))}>
            <option value="">Select a major head…</option>
            {heads.map((h) => <option key={h.code} value={h.code}>{h.code} — {h.name}</option>)}
          </select>
          <input aria-label={`Amount in rupees, row ${i + 1}`} inputMode="decimal" autoComplete="off" value={r.amount} style={{ ...inputStyle, width: 160 }}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          <Button type="button" variant="ghost" size="sm" disabled={rows.length === 1} aria-label={`Remove row ${i + 1}`}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Button type="button" variant="ghost" size="sm" onClick={() => setRows([...rows, { headCode: "", amount: "" }])}>Add head</Button>
        <span style={{ fontSize: 13, color: "var(--ink2)" }} aria-live="polite">
          Total {formatMoney(check.totalMinor)} of {formatMoney(demandAmountMinor)}
        </span>
        <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : "Save head-wise lines"}</Button>
      </div>
    </form>
  );
}
