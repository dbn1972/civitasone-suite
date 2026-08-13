"use client";

import { useState } from "react";
import { PageHeader, ConfirmDialog, useConfirmAction } from "../../../_components/ds";

export default function DepreciationRunPage() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [depBook, setDepBook] = useState<"all" | "company" | "statutory">("all");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const run = useConfirmAction({
    onConfirm: async (reason) => {
      setMessage("");
      setIsError(false);
      const res = await fetch("/api/proxy/v1/asset/depreciation/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period, depBook, reason }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage(`Depreciation run accepted for ${period} — GL journals posted via finance.gl.post.`);
    },
  });

  const bookLabel: Record<typeof depBook, string> = {
    all: "all books",
    company: "the company book (SLM → 5100)",
    statutory: "the statutory book (WDV → 5101)",
  };

  return (
    <>
      <PageHeader
        title="Depreciation Run"
        subtitle="Period-end depreciation — company (SLM) and statutory (WDV) books post to GL."
        back="/assets/dashboard"
        backLabel="Dashboard"
      />
      <div className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run.trigger();
          }}
          className="pad"
        >
          <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", marginBottom: 12 }}>
            <label className="l" htmlFor="dep-book">Depreciation book</label>
            <select id="dep-book" value={depBook} onChange={(e) => setDepBook(e.target.value as typeof depBook)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}>
              <option value="all">All books</option>
              <option value="company">Company (SLM → 5100)</option>
              <option value="statutory">Statutory (WDV → 5101)</option>
            </select>
          </div>
          <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", marginBottom: 12 }}>
            <label className="l" htmlFor="dep-period">Period (YYYY-MM)</label>
            <input id="dep-period" value={period} onChange={(e) => setPeriod(e.target.value)} pattern="\d{4}-\d{2}" style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
          </div>
          <button type="submit" className="btn primary">Run depreciation</button>
          {message ? (
            <p role="status" aria-live="polite" style={{ marginTop: 12, fontSize: 13, color: isError ? "var(--bad)" : "var(--good)" }}>{message}</p>
          ) : null}
        </form>
      </div>

      <ConfirmDialog
        open={run.open}
        title="Run period-end depreciation?"
        description={<>This posts depreciation journals to the General Ledger for <b>{period}</b> across {bookLabel[depBook]}. GL postings cannot be undone once accepted. Provide a reason to proceed.</>}
        confirmLabel="Run depreciation"
        requireReason
        reasonLabel="Reason / authorisation"
        busy={run.busy}
        errorMessage={run.error}
        onConfirm={run.confirm}
        onCancel={run.cancel}
      />
    </>
  );
}
