"use client";

/**
 * HearingsConsole — the standalone, cross-case-selectable Hearings screen
 * (court/hearings). Hearings are case-scoped server-side (no flat "all
 * hearings" GET — see hearing/routes.ts), so this console works one case at
 * a time: the page.tsx picks the case (via CaseSelector) and hands this
 * component that case's hearings. Scheduling, adjourning and recording an
 * outcome reuse the same court/_data/client.ts actions CaseConsole uses.
 *
 * Recording a hearing outcome and adjourning are both TERMINAL, official acts
 * for that hearing row (hearing/domain.ts: scheduled -> held/adjourned/
 * cancelled has no way back), so both go through <ConfirmDialog> naming the
 * case and hearing being acted on, and surface the server's real error.
 */
import { useCallback, useId, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, EmptyState, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { Hearing } from "../_data/types";
import { fmtDate, fmtDateTime, hearingPillStatus, hearingStatusLabel, humanize } from "../_data/format";
import { fetchCaseHearings, scheduleHearing } from "../_data/client";
import { formatShortId } from "@/lib/formatters";
import { AdjournDialog, OutcomeDialog } from "../_components/HearingActionDialogs";
import { errStyle, fieldStyle, mono } from "../_components/courtFormStyles";


function caseLabel(caseSummary: { title: string | null; cnrNumber: string | null }): string {
  return caseSummary.title || caseSummary.cnrNumber || "this case";
}

export function HearingsConsole({
  caseId,
  caseSummary,
  initialHearings,
  hearingsSource,
}: {
  caseId: string;
  caseSummary: { title: string | null; cnrNumber: string | null };
  initialHearings: Hearing[];
  hearingsSource: "api" | "error";
}) {
  const [hearings, setHearings] = useState<Hearing[]>(initialHearings);
  const [source, setSource] = useState<"api" | "error">(hearingsSource);
  const [toast, setToast] = useState<string | null>(null);
  // GAP-COURT-HEARINGS-04: sort by scheduledDate, newest first by default.
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const reload = useCallback(async () => {
    try {
      setHearings(await fetchCaseHearings(caseId));
      setSource("api");
    } catch {
      // Keep the current rows (don't wipe them), but stop claiming they're
      // live — a failed re-fetch after a write leaves them possibly stale.
      setSource("error");
    }
  }, [caseId]);

  const flash = useCallback((msg: string) => setToast(msg), []);

  return (
    <>
      {toast && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)" }}>
          ✓ {toast}
        </div>
      )}

      <Card title={caseLabel(caseSummary)} padding>
        <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: 0 }}>
          {caseSummary.cnrNumber && <span style={mono}>{caseSummary.cnrNumber}</span>}{" "}
          <Link className="btn ghost sm" href={`/court/cases/${caseId}`} style={{ marginLeft: 8 }}>
            Open full case console →
          </Link>
        </p>
      </Card>

      <ScheduleHearingForm
        caseId={caseId}
        onDone={async (msg) => {
          flash(msg);
          await reload();
        }}
      />

      <Card title={source === "error" ? "Hearings" : `Hearings (${hearings.length})`} padding>
        {/* A failed reload keeps showing the last-known rows (stale, not
            wiped) — the badge is the honesty signal, not an empty state. */}
        {source === "error" && <DataSourceBadge source="error" />}
        {hearings.length === 0 ? (
          source === "error" ? (
            <EmptyState
              icon="📅"
              title="Could not load hearings"
              message="Live data couldn't be reached. Newly scheduled hearings will appear once it returns."
            />
          ) : (
            <EmptyState icon="📅" title="No hearings yet" message="Schedule the first hearing above." />
          )
        ) : (
          <div style={{ overflowX: "auto" }}>
            {/* GAP-COURT-HEARINGS-04: table layout with sortable Date/Status columns */}
            <table className="tbl tbl--stack">
              <thead>
                <tr>
                  <th
                    scope="col"
                    style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                    onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                    aria-sort={sortDir === "desc" ? "descending" : "ascending"}
                  >
                    Date {sortDir === "desc" ? "▼" : "▲"}
                  </th>
                  <th scope="col">Purpose</th>
                  <th scope="col">Status</th>
                  <th scope="col">Next date</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...hearings]
                  .sort((a, b) => {
                    const ta = a.scheduledDate ? new Date(a.scheduledDate).getTime() : 0;
                    const tb = b.scheduledDate ? new Date(b.scheduledDate).getTime() : 0;
                    return sortDir === "desc" ? tb - ta : ta - tb;
                  })
                  .map((h) => (
                    <HearingRow
                      key={h.id}
                      hearing={h}
                      caseId={caseId}
                      caseLabel={caseLabel(caseSummary)}
                      onDone={async (msg) => {
                        flash(msg);
                        await reload();
                      }}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

// ─── Schedule form ───────────────────────────────────────────────────────────

function ScheduleHearingForm({
  caseId,
  onDone,
}: {
  caseId: string;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dtId = useId();
  const dtErrId = useId();
  const purposeId = useId();
  const dtRef = useRef<HTMLInputElement>(null);

  // Custom validator (NOT native min/max — that dead-codes the aria error
  // path): scheduledAt must parse and must be strictly in the future.
  function validate(): boolean {
    if (!scheduledAt) {
      setError("Enter a hearing date & time.");
      dtRef.current?.focus();
      return false;
    }
    const d = new Date(scheduledAt);
    if (Number.isNaN(d.getTime())) {
      setError("That date & time isn't valid.");
      dtRef.current?.focus();
      return false;
    }
    if (d.getTime() <= Date.now()) {
      setError("The hearing date & time must be in the future.");
      dtRef.current?.focus();
      return false;
    }
    setError(undefined);
    return true;
  }

  async function schedule(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const iso = new Date(scheduledAt).toISOString();
      await scheduleHearing(caseId, {
        scheduledAt: iso,
        ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
      });
      setScheduledAt("");
      setPurpose("");
      // Writes are command-bus backed (202 Accepted) — say "submitted", not
      // a completed fact the UI hasn't actually confirmed yet.
      await onDone("Hearing scheduling submitted.");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not schedule the hearing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Schedule a hearing" padding>
      <form onSubmit={schedule} style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <label htmlFor={dtId} style={{ fontSize: 12.5, fontWeight: 600 }}>
              Date &amp; time <span aria-hidden="true">*</span>
            </label>
            <input
              id={dtId}
              ref={dtRef}
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              aria-required="true"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? dtErrId : undefined}
              style={{ ...fieldStyle, width: "auto" }}
            />
            {error && (
              <p id={dtErrId} role="alert" style={errStyle}>
                {error}
              </p>
            )}
          </div>
          <div style={{ display: "grid", gap: 4, flex: "1 1 200px" }}>
            <label htmlFor={purposeId} style={{ fontSize: 12.5, fontWeight: 600 }}>
              Purpose (optional)
            </label>
            <input
              id={purposeId}
              placeholder="e.g. arguments"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              style={fieldStyle}
            />
          </div>
        </div>
        {serverError && (
          <p role="alert" style={errStyle}>
            {serverError}
          </p>
        )}
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Scheduling…" : "Schedule hearing"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ─── Hearing row ─────────────────────────────────────────────────────────────

function HearingRow({
  hearing,
  caseId,
  caseLabel,
  onDone,
}: {
  hearing: Hearing;
  caseId: string;
  caseLabel: string;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [showAdjourn, setShowAdjourn] = useState(false);
  const [showOutcome, setShowOutcome] = useState(false);

  const canAct = hearing.status === "scheduled";
  // Include a short id suffix — two hearings for the same case can share the
  // same scheduled minute (or lack a scheduledDate), which would otherwise
  // collide and give every "Adjourn"/"Record outcome" button on the case the
  // same accessible name.
  const rowLabel = `hearing on ${fmtDateTime(hearing.scheduledDate)} for ${caseLabel} (#${formatShortId(hearing.id)})`;

  return (
    <>
      {/* GAP-COURT-HEARINGS-04: each hearing is a table row; expandable action
          panels sit in a full-width second row beneath their parent. */}
      <tr>
        <td style={mono}>{fmtDateTime(hearing.scheduledDate)}</td>
        <td>{hearing.purpose ? humanize(hearing.purpose) : <span style={{ color: "var(--ink2)" }}>—</span>}</td>
        <td>
          <StatusPill status={hearingPillStatus(hearing.status)} label={hearingStatusLabel(hearing.status)} />
        </td>
        <td style={mono}>
          {hearing.nextDate ? fmtDate(hearing.nextDate) : <span style={{ color: "var(--ink2)" }}>—</span>}
        </td>
        <td>
          {canAct && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Adjourn the ${rowLabel}`}
                onClick={() => setShowAdjourn((v) => !v)}
              >
                Adjourn
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Record outcome for the ${rowLabel}`}
                onClick={() => setShowOutcome((v) => !v)}
              >
                Record outcome
              </Button>
            </div>
          )}
        </td>
      </tr>
      {(showAdjourn || showOutcome) && (
        <tr>
          <td colSpan={5} style={{ padding: "0 0 8px", background: "var(--surface2, var(--bg2))" }}>
            {showAdjourn && (
              <AdjournDialog
                hearing={hearing}
                caseId={caseId}
                rowLabel={rowLabel}
                onClose={() => setShowAdjourn(false)}
                onDone={onDone}
              />
            )}
            {showOutcome && (
              <OutcomeDialog
                hearing={hearing}
                rowLabel={rowLabel}
                onClose={() => setShowOutcome(false)}
                onDone={onDone}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
}
