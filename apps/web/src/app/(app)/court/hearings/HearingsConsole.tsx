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
import { Card, ConfirmDialog, EmptyState, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { Hearing } from "../_data/types";
import { fmtDate, fmtDateTime, hearingPillStatus, humanize, todayIso } from "../_data/format";
import { adjournHearing, fetchCaseHearings, recordHearingOutcome, scheduleHearing } from "../_data/client";

const fieldStyle: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 13.5,
  width: "100%",
  minHeight: 40,
};
const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};
const errStyle: React.CSSProperties = { color: "var(--bad, #c0392b)", fontSize: 12, margin: "4px 0 0" };

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
          <div style={{ display: "grid", gap: 10 }}>
            {hearings.map((h) => (
              <HearingRow
                key={h.id}
                hearing={h}
                caseLabel={caseLabel(caseSummary)}
                onDone={async (msg) => {
                  flash(msg);
                  await reload();
                }}
              />
            ))}
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
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Scheduling…" : "Schedule hearing"}
          </button>
        </div>
      </form>
    </Card>
  );
}

// ─── Hearing row ─────────────────────────────────────────────────────────────

function HearingRow({
  hearing,
  caseLabel,
  onDone,
}: {
  hearing: Hearing;
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
  const rowLabel = `hearing on ${fmtDateTime(hearing.scheduledDate)} for ${caseLabel} (#${hearing.id.slice(0, 8)})`;

  return (
    <div style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {fmtDateTime(hearing.scheduledDate)}
            {hearing.purpose && (
              <span style={{ color: "var(--ink2)", fontWeight: 400 }}> · {humanize(hearing.purpose)}</span>
            )}
          </div>
          {hearing.nextDate && (
            <div style={{ fontSize: 12.5, color: "var(--ink2)", ...mono }}>
              Next date: {fmtDate(hearing.nextDate)}
            </div>
          )}
          {hearing.adjournmentReason && (
            <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>
              Adjourned: {hearing.adjournmentReason}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <StatusPill status={hearingPillStatus(hearing.status)} label={humanize(hearing.status)} />
          {canAct && (
            <>
              <button
                type="button"
                className="btn ghost sm"
                aria-label={`Adjourn the ${rowLabel}`}
                onClick={() => setShowAdjourn(true)}
              >
                Adjourn
              </button>
              <button
                type="button"
                className="btn ghost sm"
                aria-label={`Record outcome for the ${rowLabel}`}
                onClick={() => setShowOutcome(true)}
              >
                Record outcome
              </button>
            </>
          )}
        </div>
      </div>

      {showAdjourn && (
        <AdjournDialog
          hearing={hearing}
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
    </div>
  );
}

// ─── Adjourn (ConfirmDialog — terminal for this row) ─────────────────────────

function AdjournDialog({
  hearing,
  rowLabel,
  onClose,
  onDone,
}: {
  hearing: Hearing;
  rowLabel: string;
  onClose: () => void;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [nextDate, setNextDate] = useState(todayIso());
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>();

  const reasonId = useId();
  const reasonErrId = useId();
  const dateId = useId();
  const dateErrId = useId();
  const reasonRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    let ok = true;
    if (!reason.trim()) {
      setReasonError("Enter the reason for adjournment.");
      reasonRef.current?.focus();
      ok = false;
    } else {
      setReasonError(undefined);
    }
    const d = nextDate ? new Date(`${nextDate}T00:00:00`) : null;
    if (!nextDate || !d || Number.isNaN(d.getTime())) {
      setDateError("Pick a valid next date.");
      if (ok) dateRef.current?.focus();
      ok = false;
    } else if (d.getTime() < new Date(new Date().toDateString()).getTime()) {
      setDateError("The next date must be today or later.");
      if (ok) dateRef.current?.focus();
      ok = false;
    } else {
      setDateError(undefined);
    }
    return ok;
  }

  const [confirmOpen, setConfirmOpen] = useState(false);

  function proceed() {
    setServerError(undefined);
    if (!validate()) return;
    setConfirmOpen(true);
  }

  async function confirm() {
    setBusy(true);
    setServerError(undefined);
    try {
      await adjournHearing(hearing.id, {
        reason: reason.trim(),
        nextDate,
        expectedVersion: hearing.version,
      });
      setConfirmOpen(false);
      await onDone("Adjournment submitted.");
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not adjourn the hearing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <label htmlFor={reasonId} style={{ fontSize: 12.5, fontWeight: 600 }}>
          Adjournment reason <span aria-hidden="true">*</span>
        </label>
        <input
          id={reasonId}
          ref={reasonRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-required="true"
          aria-invalid={!!reasonError || undefined}
          aria-describedby={reasonError ? reasonErrId : undefined}
          style={fieldStyle}
        />
        {reasonError && (
          <p id={reasonErrId} role="alert" style={errStyle}>
            {reasonError}
          </p>
        )}
      </div>
      <div style={{ display: "grid", gap: 4, maxWidth: 200 }}>
        <label htmlFor={dateId} style={{ fontSize: 12.5, fontWeight: 600 }}>
          Next date <span aria-hidden="true">*</span>
        </label>
        <input
          id={dateId}
          ref={dateRef}
          type="date"
          value={nextDate}
          onChange={(e) => setNextDate(e.target.value)}
          aria-required="true"
          aria-invalid={!!dateError || undefined}
          aria-describedby={dateError ? dateErrId : undefined}
          style={fieldStyle}
        />
        {dateError && (
          <p id={dateErrId} role="alert" style={errStyle}>
            {dateError}
          </p>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn primary sm" onClick={proceed}>
          Adjourn hearing
        </button>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          Cancel
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Adjourn this hearing?"
        confirmLabel="Adjourn hearing"
        danger
        busy={busy}
        errorMessage={serverError}
        description={
          <>
            Adjourn the {rowLabel} to <strong>{fmtDate(nextDate)}</strong>. This is final for this
            hearing — a fresh hearing entry is created for the next date; it cannot be undone.
          </>
        }
        onConfirm={() => void confirm()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </div>
  );
}

// ─── Record outcome (ConfirmDialog — terminal for this row) ─────────────────

function OutcomeDialog({
  hearing,
  rowLabel,
  onClose,
  onDone,
}: {
  hearing: Hearing;
  rowLabel: string;
  onClose: () => void;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [outcome, setOutcome] = useState<"held" | "cancelled">("held");
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>();

  const outcomeId = useId();
  const notesId = useId();

  async function confirm() {
    setBusy(true);
    setServerError(undefined);
    try {
      await recordHearingOutcome(hearing.id, {
        outcome,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        expectedVersion: hearing.version,
      });
      setConfirmOpen(false);
      await onDone("Outcome submitted.");
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not record the outcome.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
      <div style={{ display: "grid", gap: 4, maxWidth: 200 }}>
        <label htmlFor={outcomeId} style={{ fontSize: 12.5, fontWeight: 600 }}>
          Outcome
        </label>
        <select
          id={outcomeId}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as "held" | "cancelled")}
          style={fieldStyle}
        >
          <option value="held">Held</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <label htmlFor={notesId} style={{ fontSize: 12.5, fontWeight: 600 }}>
          Notes (optional)
        </label>
        <input id={notesId} value={notes} onChange={(e) => setNotes(e.target.value)} style={fieldStyle} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn primary sm" onClick={() => setConfirmOpen(true)}>
          Record outcome
        </button>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          Cancel
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Record this hearing's outcome?"
        confirmLabel="Confirm outcome"
        danger
        busy={busy}
        errorMessage={serverError}
        description={
          <>
            Record the {rowLabel} as <strong>{humanize(outcome)}</strong>. This is final for this
            hearing and cannot be undone.
          </>
        }
        onConfirm={() => void confirm()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </div>
  );
}
