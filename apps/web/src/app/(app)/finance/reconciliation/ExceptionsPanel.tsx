"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, DataTable, StatusPill, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import {
  MAX_NOTE_LENGTH,
  MIN_NOTE_LENGTH,
  exceptionStatusVariant,
  readableActor,
} from "./reconHelpers";

export type ExceptionStatus = "open" | "investigating" | "resolved" | "written_off";
export type ExceptionAction = "investigate" | "resolve" | "write_off" | "reopen";

export type ExceptionRow = {
  id: string;
  runId: string;
  provider: string;
  breakKey: string;
  breakType: string;
  field: string | null;
  fieldType: string | null;
  sourceValue: string | null;
  targetValue: string | null;
  deltaMinor: string | number | null;
  severity: string;
  status: ExceptionStatus | string;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
} & Record<string, unknown>;

const ACTION_LABEL: Record<ExceptionAction, string> = {
  investigate: "Investigate",
  resolve: "Resolve",
  write_off: "Write off",
  reopen: "Reopen",
};

// Mirrors the exception lifecycle state machine in @civitasone/reconciliation —
// only actions valid for the exception's current status are offered.
const AVAILABLE_ACTIONS: Record<string, ExceptionAction[]> = {
  open: ["investigate", "resolve", "write_off"],
  investigating: ["resolve", "write_off"],
  resolved: ["reopen"],
  written_off: ["reopen"],
};

/**
 * Plain-language fallback for an exception-action network failure (no
 * Response to read). toHumanError is the same catalogued-message building
 * block errorMessageFromResponse (used below for the failed-response path)
 * is built on -- never a raw exception message. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016/UX-020.
 */
function exceptionActionExceptionMessage(): string {
  const human = toHumanError("save", { area: "reconciliation exception" });
  return `${human.what} ${human.next}`;
}

/**
 * GAP-FINANCE-RECONCILIATION-02: one formatter for a break value, shared by
 * the table columns and the confirm dialog so they can never disagree.
 * Amount-typed fields are paise -> formatMoney; everything else is raw.
 */
export function formatBreakValue(row: Pick<ExceptionRow, "fieldType">, value: string | null): string {
  if (value == null) return "—";
  return row.fieldType === "amount" ? formatMoney(value) : value;
}

/** Actions whose justification is mandatory (resolve / write-off close the break). */
const NOTE_REQUIRED: ReadonlySet<ExceptionAction> = new Set(["resolve", "write_off"]);

export function ExceptionsPanel({
  exceptions,
  canAct = true,
}: {
  exceptions: ExceptionRow[];
  /**
   * Whether the session may act on exceptions (GAP-FINANCE-RECONCILIATION-03).
   * False renders the table read-only with no action buttons. Defaults to true
   * so callers that have not resolved a role keep today's behaviour; the server
   * is the authority either way.
   */
  canAct?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<{ row: ExceptionRow; action: ExceptionAction } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function runAction(note?: string) {
    if (!pending) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserFetch(`v1/finance/recon/exceptions/${pending.row.id}/action`, {
        method: "POST",
        // `note` is the audited justification (GAP-FINANCE-RECONCILIATION-01):
        // the backend persists it as resolutionNote and writes it to the audit event.
        body: JSON.stringify(note ? { action: pending.action, note } : { action: pending.action }),
      });
      if (!res.ok) {
        setDialogError(await errorMessageFromResponse(res, "save", "reconciliation exception"));
        return;
      }
      setMessage(`Exception ${pending.row.breakKey} marked "${ACTION_LABEL[pending.action]}".`);
      setPending(null);
      router.refresh();
    } catch {
      setDialogError(exceptionActionExceptionMessage());
    } finally {
      setBusy(false);
    }
  }

  // Dense 11-column layout collapsed (GAP-FINANCE-RECONCILIATION-05): provider and
  // break type ride under the break key, source/target share one cell, and the
  // Actions column leads so it stays reachable on a phone without scrolling
  // horizontally.
  const actionsColumn = {
    key: "id" as const,
    label: "Actions",
    sortable: false,
    render: (row: ExceptionRow) => {
      const actions = AVAILABLE_ACTIONS[row.status] ?? [];
      if (actions.length === 0) {
        return <span style={{ color: "var(--ink2)", fontSize: 13 }}>—</span>;
      }
      return (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {actions.map((action) => (
            <Button
              key={action}
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${ACTION_LABEL[action]} exception ${row.breakKey}`}
              onClick={() => {
                setDialogError(undefined);
                setPending({ row, action });
              }}
            >
              {ACTION_LABEL[action]}
            </Button>
          ))}
        </div>
      );
    },
  };

  const columns = [
    ...(canAct ? [actionsColumn] : []),
    {
      key: "breakKey" as const,
      label: "Break Key",
      render: (row: ExceptionRow) => (
        <div>
          <span className="mono">{row.breakKey}</span>
          <div style={{ color: "var(--ink2)", fontSize: 12 }}>
            {row.provider} · {row.breakType}
          </div>
        </div>
      ),
    },
    { key: "field" as const, label: "Field", render: (row: ExceptionRow) => row.field ?? "—" },
    {
      key: "sourceValue" as const,
      label: "Source → Target",
      align: "right" as const,
      render: (row: ExceptionRow) => (
        <span>
          {formatBreakValue(row, row.sourceValue)} → {formatBreakValue(row, row.targetValue)}
        </span>
      ),
    },
    {
      key: "deltaMinor" as const,
      label: "Delta",
      align: "right" as const,
      render: (row: ExceptionRow) => (row.deltaMinor == null ? "—" : formatMoney(row.deltaMinor)),
    },
    {
      key: "severity" as const,
      label: "Severity",
      render: (row: ExceptionRow) => (
        <StatusPill
          status={row.severity === "high" ? "overdue" : row.severity === "medium" ? "pending" : "closed"}
          label={row.severity}
        />
      ),
    },
    {
      key: "status" as const,
      label: "Status",
      render: (row: ExceptionRow) => {
        const closed = row.status === "resolved" || row.status === "written_off";
        const by = readableActor(row.resolvedBy);
        return (
          <div>
            <StatusPill status={row.status} variant={exceptionStatusVariant(row.status)} />
            {closed && (row.resolutionNote || row.resolvedAt) ? (
              <div style={{ color: "var(--ink2)", fontSize: 12, marginTop: 4, maxWidth: 260 }}>
                {row.resolutionNote ? <div>{row.resolutionNote}</div> : null}
                {row.resolvedAt ? (
                  <div>
                    {by ? `${by} · ` : ""}
                    {formatIndianDate(row.resolvedAt)}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      },
    },
    { key: "createdAt" as const, label: "Detected", render: (row: ExceptionRow) => formatIndianDate(row.createdAt) },
  ];

  return (
    <>
      {message && (
        <p role="status" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>
          {message}
        </p>
      )}
      {!canAct && (
        <p role="note" style={{ margin: "0 0 12px", color: "var(--ink2)", fontSize: 13 }}>
          You have read-only access to reconciliation. Resolving or writing off a break needs the finance officer,
          finance admin or super admin role.
        </p>
      )}
      <DataTable<ExceptionRow>
        columns={columns}
        filterKeys={["breakKey", "provider", "breakType", "field", "status"]}
        rows={exceptions}
        sortable
        filterable
        filterPlaceholder="Filter by break key, provider, or field…"
        pageSize={15}
        emptyIcon="🧩"
        emptyTitle="No exceptions"
        emptyMessage="No reconciliation breaks recorded — everything reconciled cleanly."
      />

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `${ACTION_LABEL[pending.action]} this exception?` : ""}
        confirmLabel={pending ? ACTION_LABEL[pending.action] : "Confirm"}
        danger={pending?.action === "write_off"}
        requireReason={pending ? NOTE_REQUIRED.has(pending.action) : false}
        optionalReason={pending ? !NOTE_REQUIRED.has(pending.action) : false}
        reasonLabel={pending && NOTE_REQUIRED.has(pending.action) ? "Reason (required, recorded in the audit trail)" : "Note (optional)"}
        minReasonLength={MIN_NOTE_LENGTH}
        maxReasonLength={MAX_NOTE_LENGTH}
        busy={busy}
        errorMessage={dialogError}
        description={
          pending ? (
            <>
              {ACTION_LABEL[pending.action]} exception <strong>{pending.row.breakKey}</strong> ({pending.row.breakType}
              {pending.row.field ? `, field "${pending.row.field}"` : ""}) from provider{" "}
              <strong>{pending.row.provider}</strong>.
              <dl style={{ margin: "12px 0 0", display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 16px" }}>
                <dt>Source value</dt>
                <dd style={{ margin: 0 }}>{formatBreakValue(pending.row, pending.row.sourceValue)}</dd>
                <dt>Target value</dt>
                <dd style={{ margin: 0 }}>{formatBreakValue(pending.row, pending.row.targetValue)}</dd>
                <dt>Delta</dt>
                <dd style={{ margin: 0 }}>
                  <strong>{pending.row.deltaMinor == null ? "—" : formatMoney(pending.row.deltaMinor)}</strong>
                </dd>
              </dl>
              {pending.action === "write_off" && pending.row.deltaMinor != null ? (
                <p style={{ margin: "8px 0 0" }}>
                  You are writing off <strong>{formatMoney(pending.row.deltaMinor)}</strong>.
                </p>
              ) : null}
            </>
          ) : null
        }
        onConfirm={(reason) => void runAction(reason)}
        onCancel={() => !busy && setPending(null)}
      />
    </>
  );
}
