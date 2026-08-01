"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, ConfirmDialog } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";

export type AssessmentRow = {
  id: string;
  assesseeId: string;
  rateHeadId: string;
  financialYear: string;
  baseValue: string | number;
  status: string;
  version: number;
  createdAt: string;
} & Record<string, unknown>;

function rupeesToPaiseString(val: string): string {
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.round(n * 100).toString();
}

async function patchJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(`/api/proxy/${url}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    let msg = `Request failed (${res.status}).`;
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message ? `${j.error.code}: ${j.error.message}` : (j?.message ?? j?.error ?? msg);
    } catch {
      if (text) msg = text;
    }
    throw new Error(msg);
  }
}

async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(`/api/proxy/${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    let msg = `Request failed (${res.status}).`;
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message ? `${j.error.code}: ${j.error.message}` : (j?.message ?? j?.error ?? msg);
    } catch {
      if (text) msg = text;
    }
    throw new Error(msg);
  }
}

/** Hand-rolled panel that collects the business-data field(s) before the
 * ConfirmDialog gate captures the required reason and submits. */
function FieldPanel({
  titleId,
  label,
  hint,
  value,
  onChange,
  onCancel,
  onContinue,
  error,
}: {
  titleId: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onContinue: () => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(16,24,40,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
    >
      <div className="card" style={{ width: "min(420px,100%)" }}>
        <div className="pad" style={{ display: "grid", gap: 10 }}>
          <label htmlFor={`${titleId}-input`} style={{ fontSize: 13, fontWeight: 600 }}>
            {label} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
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
          {error && <p id={`${titleId}-err`} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn primary" onClick={onContinue}>Continue</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AssessmentsTable({ assessments }: { assessments: AssessmentRow[] }) {
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
    if (!newBaseValue.trim() || Number.isNaN(parseFloat(newBaseValue)) || parseFloat(newBaseValue) < 0) {
      setReviseFieldError("Enter a valid non-negative base value (₹).");
      return;
    }
    setReviseFieldError(undefined);
    setDialogError(undefined);
    setReviseConfirmOpen(true);
  }

  async function submitRevise(reason?: string) {
    if (!revisingRow) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await patchJson(`v1/revenue/assessments/${revisingRow.id}/revise`, {
        version: revisingRow.version,
        reason: (reason ?? "").trim(),
        newBaseValue: rupeesToPaiseString(newBaseValue),
      });
      setReviseConfirmOpen(false);
      setRevisingRow(null);
      setMessage(`Assessment for FY ${revisingRow.financialYear} revised.`);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
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
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
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
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: "financialYear" as const, label: "FY" },
    { key: "assesseeId" as const, label: "Assessee", render: (r: AssessmentRow) => <span className="mono">{r.assesseeId.slice(0, 8)}…</span> },
    { key: "baseValue" as const, label: "Base Value", align: "right" as const, cellType: "amount" as const },
    { key: "status" as const, label: "Status", cellType: "status" as const },
    { key: "version" as const, label: "Version", align: "right" as const },
    {
      key: "id" as const,
      label: "Actions",
      sortable: false,
      render: (row: AssessmentRow) => (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn ghost sm"
            aria-label={`Revise assessment for FY ${row.financialYear}`}
            disabled={row.status !== "active"}
            onClick={() => startRevise(row)}
          >
            Revise
          </button>
          <button
            type="button"
            className="btn ghost sm"
            aria-label={`Request remission for FY ${row.financialYear} assessment`}
            disabled={row.status !== "active"}
            onClick={() => startRemit(row)}
          >
            Remit
          </button>
          <button
            type="button"
            className="btn ghost sm"
            aria-label={`Approve remission for FY ${row.financialYear} assessment`}
            onClick={() => startDecide(row, true)}
          >
            Approve
          </button>
          <button
            type="button"
            className="btn ghost sm"
            aria-label={`Reject remission for FY ${row.financialYear} assessment`}
            onClick={() => startDecide(row, false)}
          >
            Reject
          </button>
        </div>
      ),
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
