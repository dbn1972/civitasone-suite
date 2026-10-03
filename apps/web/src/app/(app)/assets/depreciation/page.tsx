"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, PageHeader, ConfirmDialog, ErrorState, useConfirmAction } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { todayIST, formatMoney, formatIndianDate, formatIndianDateTime } from "@/lib/formatters";
import { periodError } from "./period";
import { parseRunStatus, runState, pendingTotals, postedTotals, type RunStatus } from "./runStatus";
import { errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";

type Book = "all" | "company" | "statutory";

/** "2026-08" -> "Aug 2026" (period labels read as months, not as raw codes). */
function periodLabel(period: string): string {
  return formatIndianDate(`${period}-01`).replace(/^\d{1,2}\s/, "");
}

export default function DepreciationRunPage() {
  const currentMonth = todayIST().slice(0, 7);
  const [period, setPeriod] = useState(currentMonth);
  const [depBook, setDepBook] = useState<Book>("all");
  const [message, setMessage] = useState("");
  const error = periodError(period, currentMonth);

  // Preview / last-run state. "loading", "error" and "ok" are distinct (a failed preview is not "nothing to post").
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [statusState, setStatusState] = useState<"loading" | "error" | "ok">("loading");
  const [statusTick, setStatusTick] = useState(0);

  const loadStatus = useCallback(async (signal: AbortSignal) => {
    if (periodError(period, currentMonth)) return;
    setStatusState("loading");
    try {
      const res = await fetch(`/api/proxy/v1/asset/depreciation/status?period=${encodeURIComponent(period)}&depBook=${depBook}`, { signal });
      const parsed = res.ok ? parseRunStatus(await res.json().catch(() => null)) : null;
      if (!parsed) { setStatusState("error"); return; }
      setStatus(parsed);
      setStatusState("ok");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setStatusState("error");
    }
  }, [period, depBook, currentMonth]);

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus, statusTick]);

  const state = status && statusState === "ok" ? runState(status) : null;
  const pending = status && statusState === "ok" ? pendingTotals(status) : null;
  const posted = status && statusState === "ok" ? postedTotals(status) : null;
  // Nothing to post (already posted, or no schedule entries) blocks submit; an unavailable preview does not
  // (the service still answers 409 for an already-posted period).
  const blocked = state === "already_posted" || state === "no_entries";

  const run = useConfirmAction({
    onConfirm: async (reason) => {
      setMessage("");
      const res = await fetch("/api/proxy/v1/asset/depreciation/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period, depBook, reason }),
      });
      if (!res.ok) {
        // GAP-ASSETS-DEPRECIATION-02: an already-posted period is its own message, not a generic failure.
        if ((await errorCodeFromResponse(res)) === "ALREADY_POSTED") {
          setStatusTick((n) => n + 1);
          throw new Error(`Depreciation for ${periodLabel(period)} has already been posted. Nothing was queued.`);
        }
        // GAP-ASSETS-DEPRECIATION-05: plain copy, never the raw response body.
        throw new Error(await errorMessageFromResponse(res, "save", "depreciation run"));
      }
      const body = (await res.json().catch(() => ({}))) as { id?: unknown };
      const ref = typeof body.id === "string" ? ` Reference ${body.id}.` : "";
      // GAP-ASSETS-DEPRECIATION-01: the service answers 202 Accepted and a
      // background consumer posts the journals -- say "queued", never "posted".
      setMessage(`Depreciation run for ${period} queued. GL journals will post shortly once it is processed.${ref}`);
      setStatusTick((n) => n + 1);
    },
  });

  // GAP-ASSETS-DEPRECIATION-04: no GL account numbers here -- the account each
  // book posts to is the Finance chart of accounts' concern and would drift.
  const bookLabel: Record<Book, string> = {
    all: "all books",
    company: "the company book (SLM)",
    statutory: "the statutory book (WDV)",
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
            if (error || blocked) return;
            run.trigger();
          }}
          className="pad"
        >
          <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start", marginBottom: 12 }}>
            <label className="l" htmlFor="dep-book">Depreciation book</label>
            <select id="dep-book" value={depBook} onChange={(e) => setDepBook(e.target.value as Book)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}>
              <option value="all">All books</option>
              <option value="company">Company book (SLM)</option>
              <option value="statutory">Statutory book (WDV)</option>
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

          {/* Last run + preview for the chosen period (read-only). */}
          {!error ? (
            <div aria-live="polite" style={{ marginBottom: 12, fontSize: 13 }} data-testid="dep-run-preview">
              {statusState === "loading" ? (
                <p style={{ color: "var(--muted)", margin: 0 }}>Checking what has been posted…</p>
              ) : statusState === "error" ? (
                <ErrorState error={toHumanError("load", { area: "depreciation status" })} onRetry={() => setStatusTick((n) => n + 1)} />
              ) : (
                <>
                  <p style={{ margin: "0 0 4px" }}>
                    {status?.lastPosted
                      ? <>Last posted period: <b>{periodLabel(status.lastPosted.period)}</b> (posted {formatIndianDateTime(status.lastPosted.postedAt)}).</>
                      : "No depreciation has been posted yet."}
                  </p>
                  {state === "ready" && pending ? (
                    <p style={{ margin: 0 }}>
                      This run will post <b>{pending.count}</b> {pending.count === 1 ? "entry" : "entries"} totalling <b>{formatMoney(pending.minor)}</b> for {periodLabel(period)}.
                    </p>
                  ) : null}
                  {state === "already_posted" && posted ? (
                    <p role="status" style={{ margin: 0, color: "var(--warn)" }}>
                      {periodLabel(period)} is already posted ({posted.count} {posted.count === 1 ? "entry" : "entries"}, {formatMoney(posted.minor)}). There is nothing left to run.
                    </p>
                  ) : null}
                  {state === "no_entries" ? (
                    <p role="status" style={{ margin: 0, color: "var(--warn)" }}>
                      No depreciation entries are scheduled for {periodLabel(period)}.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          <Button type="submit" disabled={!!error || blocked}>Run depreciation</Button>
          {message ? (
            <p role="status" aria-live="polite" style={{ marginTop: 12, fontSize: 13, color: "var(--good)" }}>{message}</p>
          ) : null}
        </form>
      </div>

      <ConfirmDialog
        open={run.open}
        title="Run period-end depreciation?"
        description={<>This queues depreciation journals to the General Ledger for <b>{period}</b> across {bookLabel[depBook]}{pending && pending.count > 0 ? <> ({pending.count} {pending.count === 1 ? "entry" : "entries"}, {formatMoney(pending.minor)})</> : null}. GL postings cannot be undone once processed. Provide a reason to proceed.</>}
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
