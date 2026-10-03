"use client";

/**
 * GAP-FINANCE-STATUTORY-TDS-RETURNS-04: quarterly TDS return filing register with a "Mark filed"
 * action that records the acknowledgement number from the external e-filing portal.
 * POST /v1/finance/tds-returns/:fy/:quarter/file (finance_officer / finance_admin / super_admin).
 * Nothing here files with the portal -- it records that the return was filed. The server audits
 * the recording once and refuses a second recording of the same quarter (409).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, DataTable, StatusPill } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { validAckNo, validFilingDate, type TdsFiling } from "./tdsFilings";

const inputStyle = { padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const STATUS_VARIANT = { filed: "good", overdue: "bad", pending: "warn" } as const;
const STATUS_LABEL = { filed: "Filed", overdue: "Overdue", pending: "Pending" } as const;

export function TdsFilingsPanel({ fy, filings, canFile }: { fy: string; filings: TdsFiling[]; canFile: boolean }) {
  const router = useRouter();
  const formError = useFormError("TDS return");
  const [open, setOpen] = useState<TdsFiling | null>(null);
  const [ackNo, setAckNo] = useState("");
  const [filedOn, setFiledOn] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function begin(f: TdsFiling) {
    setOpen(f); setAckNo(""); setFiledOn(""); setError(""); setNote("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!open) return;
    setError("");
    if (!validAckNo(ackNo)) { setError("Enter the acknowledgement number: 6 to 32 letters or digits."); return; }
    const dateCheck = validFilingDate(fy, open.quarter, filedOn, todayIst());
    if (dateCheck === "format") { setError("Enter the date the return was filed."); return; }
    if (dateCheck === "future") { setError("The filing date cannot be in the future."); return; }
    if (dateCheck === "early") { setError("A return cannot be filed on or before the last day of its quarter."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/finance/tds-returns/${encodeURIComponent(fy)}/${encodeURIComponent(open.quarter)}/file`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ ackNo: ackNo.trim(), filedOn }),
      });
      if (!res.ok) { setError((await formError.fromResponse(res, res.status === 409 ? "conflict" : "save")).message); return; }
      setNote(`${open.quarter} return recorded as filed. It appears here once processed.`);
      setOpen(null);
      router.refresh();
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {note ? <p role="status" style={{ padding: "8px 16px", fontSize: 13 }}>{note}</p> : null}
      <DataTable<TdsFiling>
        columns={[
          { key: "quarter", label: "Quarter" },
          { key: "formType", label: "Form" },
          { key: "dueDate", label: "Due date", cellType: "date" },
          { key: "status", label: "Status", render: (f) => <StatusPill status={f.status} variant={STATUS_VARIANT[f.status]} label={STATUS_LABEL[f.status]} /> },
          { key: "ackNo", label: "Acknowledgement no.", render: (f) => (f.ackNo ? <span className="mono">{f.ackNo}</span> : "—") },
          { key: "filedOn", label: "Filed on", render: (f) => (f.filedOn ? formatIndianDate(f.filedOn) : "—") },
          { key: "filedByName", label: "Recorded by", render: (f) => f.filedByName ?? (f.status === "filed" ? "—" : "") },
          { key: "deductionCount", label: "Deductions", align: "right" },
          { key: "totalTdsMinor", label: "Total TDS", align: "right", cellType: "amount" },
          {
            key: "actions" as keyof TdsFiling & string,
            label: "Actions",
            sortable: false,
            render: (f) =>
              f.status !== "filed" && canFile ? (
                <Button type="button" variant="ghost" size="sm" aria-label={`Mark ${f.quarter} return filed`} onClick={() => begin(f)}>Mark filed</Button>
              ) : null,
          },
        ]}
        rows={filings}
        pageSize={8}
        emptyIcon="📑"
        emptyTitle="No quarters"
        emptyMessage="No filing quarters for this financial year."
      />
      {open ? (
        <form onSubmit={submit} noValidate aria-label={`Record ${open.quarter} return as filed`} className="pad" style={{ borderTop: "1px solid var(--line)" }}>
          <p style={{ fontSize: 13, margin: "0 0 8px" }}>
            Record that the <strong>{open.formType}</strong> return for <strong>{fy} {open.quarter}</strong> was filed on the e-filing portal
            ({formatMoney(open.totalTdsMinor)} TDS across {open.deductionCount} deduction{open.deductionCount === 1 ? "" : "s"}).
            {open.undepositedCount > 0 ? ` ${open.undepositedCount} deduction${open.undepositedCount === 1 ? " is" : "s are"} not yet marked deposited.` : ""}
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label className="l" htmlFor="tds-ack">Acknowledgement number</label><br />
              <input id="tds-ack" value={ackNo} maxLength={32} autoComplete="off" style={inputStyle} onChange={(e) => setAckNo(e.target.value)} />
            </div>
            <div>
              <label className="l" htmlFor="tds-filed-on">Filed on</label><br />
              <input id="tds-filed-on" type="date" max={todayIst()} value={filedOn} style={inputStyle} onChange={(e) => setFiledOn(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : "Record as filed"}</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(null)}>Cancel</Button>
          </div>
          {error ? <p role="alert" style={{ color: "#b91c1c", fontSize: 13 }}>{error}</p> : null}
        </form>
      ) : null}
    </>
  );
}
