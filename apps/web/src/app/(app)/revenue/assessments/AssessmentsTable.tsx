"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, DataTable, ConfirmDialog, Modal } from "@/app/_components/ds";
import { formatMoney, formatShortId } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { rupeesToMinorString } from "@/lib/money";

export type AssessmentRow = {
  id: string;
  assesseeId: string;
  rateHeadId: string;
  financialYear: string;
  baseValue: string | number;
  status: string;
  version: number;
  createdAt: string;
  // GAP-REVENUE-ASSESSMENTS-01: latest remission state, surfaced by the server
  // (GET /v1/revenue/assessments) so the UI can gate Approve/Reject/Remit.
  remissionStatus?: "none" | "pending" | "approved" | "rejected";
  remissionRequestedBy?: string | null;
  // GAP-REVENUE-ASSESSMENTS-02: resolved owner label (page builds the map).
  assesseeName?: string;
  rateHeadName?: string;
} & Record<string, unknown>;

/**
 * Plain-language failure message for a failed assessment action (revise,
 * remit, or a remission decision). `patchJson`/`postJson` are plain
 * module-scope helpers, not components, so they can't use the useFormError
 * hook; toHumanError is the same catalogued-message building block that hook
 * is built on — never the backend's own `message`/`error`/`code` or the raw
 * HTTP status. Reused by the component's own catch blocks below so a genuine
 * network exception (which these helpers never see, since `fetch()` itself
 * can throw before either function's own res.ok check runs) also never
 * surfaces its raw browser message. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function assessmentActionError(): string {
  const human = toHumanError("save", { area: "assessment" });
  return `${human.what} ${human.next}`;
}

async function patchJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(`/api/proxy/${url}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!(res.ok || res.status === 202)) throw new Error(assessmentActionError());
}

async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(`/api/proxy/${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!(res.ok || res.status === 202)) throw new Error(assessmentActionError());
}

/** Panel that collects the business-data field(s) before the ConfirmDialog
 * gate captures the required reason and submits.
 *
 * SF-19: built on ds/Modal, which owns the body portal, `inert` background,
 * focus-in (first control = the input), Tab trap, Escape and focus restore.
 * A validation error re-focuses the invalid input.
 */
function FieldPanel({
  titleId,
  title,
  label,
  hint,
  value,
  onChange,
  onCancel,
  onContinue,
  error,
}: {
  titleId: string;
  title: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onContinue: () => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-focus the invalid field whenever a new validation error appears.
  useEffect(() => {
    if (error) inputRef.current?.focus();
  }, [error]);

  return (
    <Modal open onClose={onCancel} title={title} closeOnOverlayClick={false}>
      <div>
        <div className="pad" style={{ display: "grid", gap: 10 }}>
          <label htmlFor={`${titleId}-input`} style={{ fontSize: 13, fontWeight: 600 }}>
            {label} <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
          </label>
          <input
            id={`${titleId}-input`}
            ref={inputRef}
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-required="true"
            aria-invalid={!!error || undefined}
            aria-describedby={error ? `${titleId}-err` : undefined}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          />
          {hint && <p style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{hint}</p>}
          {error && <p id={`${titleId}-err`} role="alert" style={{ color: "var(--bad)", fontSize: 12, margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button type="button" onClick={onContinue}>Continue</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function AssessmentsTable({
  assessments,
  currentUserId,
}: {
  assessments: AssessmentRow[];
  currentUserId?: string | null;
}) {
  const router = useRouter();

  const [revisingRow, setRevisingRow] = useState<AssessmentRow | null>(null);
  const [newBaseValue, setNewBaseValue] = useState("");
  const [reviseFieldError, setReviseFieldError] = useState<string | undefined>();
  const [reviseConfirmOpen, setReviseConfirmOpen] = useState(false);

  const [remittingRow, setRemittingRow] = useState<AssessmentRow | null>(null);
  const [remissionPercent, setRemissionPercent] = useState("");
  const [remitFieldError, setRemitFieldError] = useState<string | undefined>();
  const [remitConfirmOpen, setRemitConfirmOpen] = useState(false);

  const [decidingRow, setDecidingRow] = useState<{ row: AssessmentRow; approve: boolean } | null>(null);
  const [decideConfirmOpen, setDecideConfirmOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const reviseTitleId = useId();
  const remitTitleId = useId();

  function startRevise(row: AssessmentRow) {
    setRevisingRow(row);
    setNewBaseValue("");
    setReviseFieldError(undefined);
  }

  function continueRevise() {
    if (rupeesToMinorString(newBaseValue) === null) {
      setReviseFieldError("Enter an amount in rupees with up to 2 decimals, e.g. 850000 or 8500.50.");
      return;
    }
    setReviseFieldError(undefined);
    setDialogError(undefined);
    setReviseConfirmOpen(true);
  }

  async function submitRevise(reason?: string) {
    if (!revisingRow) return;
    const newBaseValueMinor = rupeesToMinorString(newBaseValue);
    if (newBaseValueMinor === null) {
      setReviseConfirmOpen(false);
      setReviseFieldError("Enter an amount in rupees with up to 2 decimals, e.g. 850000 or 8500.50.");
      return;
    }
    setBusy(true);
    setDialogError(undefined);
    try {
      await patchJson(`v1/revenue/assessments/${revisingRow.id}/revise`, {
        version: revisingRow.version,
        reason: (reason ?? "").trim(),
        newBaseValue: newBaseValueMinor,
      });
      setReviseConfirmOpen(false);
      setRevisingRow(null);
      setMessage(`Assessment for FY ${revisingRow.financialYear} revised.`);
      router.refresh();
    } catch {
      setDialogError(assessmentActionError());
    } finally {
      setBusy(false);
    }
  }

  function startRemit(row: AssessmentRow) {
    setRemittingRow(row);
    setRemissionPercent("");
    setRemitFieldError(undefined);
  }

  function continueRemit() {
    const n = parseInt(remissionPercent, 10);
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      setRemitFieldError("Enter a remission percentage between 1 and 100.");
      return;
    }
    setRemitFieldError(undefined);
    setDialogError(undefined);
    setRemitConfirmOpen(true);
  }

  async function submitRemit(reason?: string) {
    if (!remittingRow) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await postJson(`v1/revenue/assessments/${remittingRow.id}/remit`, {
        reason: (reason ?? "").trim(),
        remissionPercent: parseInt(remissionPercent, 10),
      });
      setRemitConfirmOpen(false);
      setRemittingRow(null);
      setMessage(`Remission of ${remissionPercent}% requested for FY ${remittingRow.financialYear} (pending checker approval).`);
      router.refresh();
    } catch {
      setDialogError(assessmentActionError());
    } finally {
      setBusy(false);
    }
  }

  function startDecide(row: AssessmentRow, approve: boolean) {
    setDecidingRow({ row, approve });
    setDialogError(undefined);
    setDecideConfirmOpen(true);
  }

  async function submitDecide(reason?: string) {
    if (!decidingRow) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await patchJson(`v1/revenue/assessments/${decidingRow.row.id}/remit-decide`, {
        approve: decidingRow.approve,
        reason: reason?.trim() || undefined,
      });
      setDecideConfirmOpen(false);
      setMessage(
        `Remission for FY ${decidingRow.row.financialYear} ${decidingRow.approve ? "approved" : "rejected"}.`,
      );
      setDecidingRow(null);
      router.refresh();
    } catch {
      setDialogError(assessmentActionError());
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: "financialYear" as const, label: "FY" },
    {
      key: "assesseeId" as const,
      label: "Assessee",
      render: (r: AssessmentRow) =>
        r.assesseeName ? (
          <span>{r.assesseeName}</span>
        ) : (
          <span className="mono">{r.assesseeId.slice(0, 8)}…</span>
        ),
    },
    {
      key: "rateHeadId" as const,
      label: "Rate Head",
      render: (r: AssessmentRow) =>
        r.rateHeadName ? <span>{r.rateHeadName}</span> : <span className="mono">{r.rateHeadId.slice(0, 8)}…</span>,
    },
    { key: "baseValue" as const, label: "Base Value", align: "right" as const, cellType: "amount" as const },
    { key: "status" as const, label: "Status", cellType: "status" as const },
    { key: "version" as const, label: "Rev.", align: "right" as const }, /* GAP-REVENUE-ASSESSMENTS-05: no version-history route; shown as abbreviated "Rev." (revision counter) */
    {
      key: "id" as const,
      label: "Actions",
      sortable: false,
      render: (row: AssessmentRow) => {
        const shortId = formatShortId(row.id);
        // GAP-REVENUE-ASSESSMENTS-01: a remission decision is only valid on a
        // row that HAS a pending remission, and the deciding officer must differ
        // from the officer who requested it (separation of duties). Pre-disable
        // Approve/Reject accordingly. Fail OPEN when remissionStatus is absent
        // (older server / field missing) so a legitimate checker is never locked
        // out — the server remains the authority and rejects an invalid decision.
        const remissionStatus = row.remissionStatus;
        const hasPending = remissionStatus === "pending";
        const isMaker =
          !!currentUserId && !!row.remissionRequestedBy && currentUserId === row.remissionRequestedBy;
        // Only gate when we actually know the status; absent => fail open.
        const decideDisabled = remissionStatus !== undefined && (!hasPending || isMaker);
        const decideTitle = isMaker
          ? "You requested this remission; a different officer must decide."
          : !hasPending && remissionStatus !== undefined
            ? "No pending remission to decide on this assessment."
            : undefined;
        // Prevent raising a duplicate remission while one is already pending.
        const remitDisabled = row.status !== "active" || hasPending;
        return (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Revise assessment ${shortId} for FY ${row.financialYear}`}
              disabled={row.status !== "active"}
              onClick={() => startRevise(row)}
            >
              Revise
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Request remission for assessment ${shortId}, FY ${row.financialYear}`}
              title={hasPending ? "A remission is already pending for this assessment." : undefined}
              disabled={remitDisabled}
              onClick={() => startRemit(row)}
            >
              Remit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Approve remission for assessment ${shortId}, FY ${row.financialYear}`}
              title={decideTitle}
              disabled={decideDisabled}
              onClick={() => startDecide(row, true)}
            >
              Approve
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Reject remission for assessment ${shortId}, FY ${row.financialYear}`}
              title={decideTitle}
              disabled={decideDisabled}
              onClick={() => startDecide(row, false)}
            >
              Reject
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      {message && (
        <p role="status" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>
          {message}
        </p>
      )}

      <DataTable<AssessmentRow>
        columns={columns}
        rows={assessments}
        sortable
        filterable
        filterPlaceholder="Filter by financial year, assessee, or status…"
        pageSize={15}
        emptyIcon="📊"
        emptyTitle="No assessments yet"
        emptyMessage="Assessments raised against assessees will appear here."
      />

      {revisingRow && !reviseConfirmOpen && (
        <FieldPanel
          titleId={reviseTitleId}
          title="Revise this assessment — enter new base value"
          label="New Base Value (₹)"
          hint={`Current base value: ${formatMoney(revisingRow.baseValue)}. This recomputes the demand.`}
          value={newBaseValue}
          onChange={setNewBaseValue}
          error={reviseFieldError}
          onCancel={() => setRevisingRow(null)}
          onContinue={continueRevise}
        />
      )}

      <ConfirmDialog
        open={reviseConfirmOpen}
        title="Revise this assessment?"
        confirmLabel="Revise assessment"
        requireReason
        reasonLabel="Reason for revision"
        busy={busy}
        errorMessage={dialogError}
        description={
          revisingRow ? (
            <>
              Revise the FY <strong>{revisingRow.financialYear}</strong> assessment's base value to{" "}
              <strong>₹{newBaseValue || "0"}</strong>. This recomputes and updates the associated demand and cannot
              be undone from this screen.
            </>
          ) : null
        }
        onConfirm={(reason) => void submitRevise(reason)}
        onCancel={() => {
          if (!busy) {
            setReviseConfirmOpen(false);
            setDialogError(undefined);
          }
        }}
      />

      {remittingRow && !remitConfirmOpen && (
        <FieldPanel
          titleId={remitTitleId}
          title="Request remission — enter percent"
          label="Remission Percent (1–100)"
          hint="This raises a remission request pending a distinct checker's approval."
          value={remissionPercent}
          onChange={setRemissionPercent}
          error={remitFieldError}
          onCancel={() => setRemittingRow(null)}
          onContinue={continueRemit}
        />
      )}

      <ConfirmDialog
        open={remitConfirmOpen}
        title="Request this remission?"
        confirmLabel="Request remission"
        requireReason
        reasonLabel="Reason for remission"
        busy={busy}
        errorMessage={dialogError}
        description={
          remittingRow ? (
            <>
              Request a <strong>{remissionPercent || 0}%</strong> remission on the FY{" "}
              <strong>{remittingRow.financialYear}</strong> assessment. A distinct checker must approve before it
              takes effect.
            </>
          ) : null
        }
        onConfirm={(reason) => void submitRemit(reason)}
        onCancel={() => {
          if (!busy) {
            setRemitConfirmOpen(false);
            setDialogError(undefined);
          }
        }}
      />

      <ConfirmDialog
        open={decideConfirmOpen}
        title={decidingRow?.approve ? "Approve this remission?" : "Reject this remission?"}
        confirmLabel={decidingRow?.approve ? "Approve remission" : "Reject remission"}
        danger={decidingRow ? !decidingRow.approve : false}
        reasonLabel="Reason (optional)"
        busy={busy}
        errorMessage={dialogError}
        description={
          decidingRow ? (
            <>
              {decidingRow.approve ? "Approving" : "Rejecting"} the pending remission on the FY{" "}
              <strong>{decidingRow.row.financialYear}</strong> assessment. The deciding officer must be different
              from the officer who requested the remission — the server rejects same-user maker-checker decisions.
            </>
          ) : null
        }
        onConfirm={(reason) => void submitDecide(reason)}
        onCancel={() => {
          if (!busy) {
            setDecideConfirmOpen(false);
            setDecidingRow(null);
            setDialogError(undefined);
          }
        }}
      />
    </>
  );
}
