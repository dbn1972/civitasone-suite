"use client";

import { useState } from "react";
import { Button, PageHeader, ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import { todayIST } from "@/lib/formatters";
import { periodError } from "./period";

export default function DepreciationRunPage() {
  const currentMonth = todayIST().slice(0, 7);
  const [period, setPeriod] = useState(currentMonth);
  const [depBook, setDepBook] = useState<"all" | "company" | "statutory">("all");
  const [message, setMessage] = useState("");
  const error = periodError(period, currentMonth);

  const run = useConfirmAction({
    onConfirm: async (reason) => {
      setMessage("");
      const res = await fetch("/api/proxy/v1/asset/depreciation/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period, depBook, reason }),
      });
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json().catch(() => ({}))) as { id?: unknown };
      const ref = typeof body.id === "string" ? ` Reference ${body.id}.` : "";
      // GAP-ASSETS-DEPRECIATION-01: the service answers 202 Accepted and a
      // background consumer posts the journals -- say "queued", never "posted".
      setMessage(`Depreciation run for ${period} queued. GL journals will post shortly once it is processed.${ref}`);
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
            if (error) return;
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
            <label className="l" htmlFor="dep-period">Period</label>
            <input
              id="dep-period"
              type="month"
              value={period}
              max={currentMonth}
              onChange={(e) => { setPeriod(e.target.value); setMessage(""); }}
              aria-invalid={!!error || undefined}
              aria-describedby={error ? "dep-period-err" : "dep-period-help"}
              style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}
            />
            {error ? (
              <p id="dep-period-err" role="alert" style={{ color: "var(--bad)", fontSize: 12, margin: "4px 0 0" }}>{error}</p>
            ) : (
              <p id="dep-period-help" style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 0" }}>
                Only entries not yet posted for this period are processed, so re-running a period does not post twice.
              </p>
            )}
          </div>
          <Button type="submit" disabled={!!error}>Run depreciation</Button>
          {message ? (
            <p role="status" aria-live="polite" style={{ marginTop: 12, fontSize: 13, color: "var(--good)" }}>{message}</p>
          ) : null}
        </form>
      </div>

      <ConfirmDialog
        open={run.open}
        title="Run period-end depreciation?"
        description={<>This queues depreciation journals to the General Ledger for <b>{period}</b> across {bookLabel[depBook]}. GL postings cannot be undone once processed. Provide a reason to proceed.</>}
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
