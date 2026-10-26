"use client";

/**
 * Hearing action dialogs shared by the standalone Hearings console and the case
 * console (GAP-COURT-CASES-CASEID-01): ONE implementation of adjourn (reason +
 * next date, optional successor hearing) and record outcome, both terminal acts
 * gated by a ConfirmDialog.
 */
import { useId, useRef, useState } from "react";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import type { Hearing } from "../_data/types";
import { fmtDate, humanize, todayIso } from "../_data/format";
import { adjournHearing, recordHearingOutcome, scheduleHearing } from "../_data/client";
import { errStyle, fieldStyle } from "./courtFormStyles";

// ─── Adjourn (ConfirmDialog — terminal for this row) ─────────────────────────

export function AdjournDialog({
  hearing,
  caseId,
  rowLabel,
  onClose,
  onDone,
}: {
  hearing: Hearing;
  caseId: string;
  rowLabel: string;
  onClose: () => void;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [nextDate, setNextDate] = useState(todayIso());
  const [alsoSchedule, setAlsoSchedule] = useState(true);
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>();
  // When the adjourn committed but the follow-up schedule failed, we must NOT
  // re-adjourn on retry (that hearing is already adjourned) — only re-schedule.
  const [adjournDone, setAdjournDone] = useState(false);

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
    let alreadyAdjourned = adjournDone;
    try {
      // Step 1: adjourn (guarded so a retry after a failed step 2 never
      // double-adjourns).
      if (!alreadyAdjourned) {
        await adjournHearing(hearing.id, {
          reason: reason.trim(),
          nextDate,
          expectedVersion: hearing.version,
        });
        alreadyAdjourned = true;
        setAdjournDone(true);
      }
      // Step 2 (opt-in, default on): create the successor hearing on nextDate.
      // Two non-atomic commands — if this fails we keep the dialog open with a
      // "Schedule next hearing" retry rather than silently leaving the case
      // with no future hearing (GAP-COURT-HEARINGS-01).
      if (alsoSchedule) {
        const scheduledAt = new Date(`${nextDate}T10:30:00`).toISOString();
        await scheduleHearing(caseId, {
          scheduledAt,
          ...(hearing.purpose ? { purpose: hearing.purpose } : {}),
        });
      }
      setConfirmOpen(false);
      await onDone(
        alsoSchedule
          ? "Adjournment submitted and the next hearing was scheduled."
          : "Adjournment submitted.",
      );
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not adjourn the hearing.";
      setServerError(
        alreadyAdjourned && alsoSchedule
          ? `Adjourned, but scheduling the next hearing failed: ${msg}`
          : msg,
      );
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
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={alsoSchedule}
          onChange={(e) => setAlsoSchedule(e.target.checked)}
        />
        Also schedule the next hearing on this date
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="primary" size="sm" onClick={proceed}>
          Adjourn hearing
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Adjourn this hearing?"
        confirmLabel={adjournDone ? "Schedule next hearing" : "Adjourn hearing"}
        danger
        busy={busy}
        errorMessage={serverError}
        description={
          <>
            Adjourn the {rowLabel} to <strong>{fmtDate(nextDate)}</strong>. This is final for this
            hearing and cannot be undone.{" "}
            {alsoSchedule ? (
              <>A new hearing will be scheduled on {fmtDate(nextDate)} automatically.</>
            ) : (
              <>
                No new hearing will be created — the case will need one scheduled separately for{" "}
                {fmtDate(nextDate)}.
              </>
            )}
          </>
        }
        onConfirm={() => void confirm()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </div>
  );
}

// ─── Record outcome (ConfirmDialog — terminal for this row) ─────────────────

export function OutcomeDialog({
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
        <Button variant="primary" size="sm" onClick={() => setConfirmOpen(true)}>
          Record outcome
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
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
