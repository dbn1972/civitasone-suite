"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

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

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { code?: string; message?: string; error?: { code?: string; message?: string } };
    const code = body.code ?? body.error?.code;
    const message = body.message ?? body.error?.message;
    if (code && message) return `${code}: ${message}`;
    return message ?? code ?? `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}

export function ExceptionsPanel({ exceptions }: { exceptions: ExceptionRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<{ row: ExceptionRow; action: ExceptionAction } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function runAction() {
    if (!pending) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserFetch(`v1/finance/recon/exceptions/${pending.row.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action: pending.action }),
      });
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res));
      }
      setMessage(`Exception ${pending.row.breakKey} marked "${ACTION_LABEL[pending.action]}".`);
      setPending(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: "breakKey" as const, label: "Break Key", render: (row: ExceptionRow) => <span className="mono">{row.breakKey}</span> },
    { key: "provider" as const, label: "Provider" },
    { key: "breakType" as const, label: "Type" },
    { key: "field" as const, label: "Field", render: (row: ExceptionRow) => row.field ?? "—" },
    {
      key: "sourceValue" as const,
      label: "Source Value",
      align: "right" as const,
      render: (row: ExceptionRow) =>
        row.fieldType === "amount" && row.sourceValue != null ? formatMoney(row.sourceValue) : row.sourceValue ?? "—",
    },
    {
      key: "targetValue" as const,
      label: "Target Value",
      align: "right" as const,
      render: (row: ExceptionRow) =>
        row.fieldType === "amount" && row.targetValue != null ? formatMoney(row.targetValue) : row.targetValue ?? "—",
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
    { key: "status" as const, label: "Status", cellType: "status" as const },
    { key: "createdAt" as const, label: "Detected", render: (row: ExceptionRow) => formatIndianDate(row.createdAt) },
    {
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
              <button
                key={action}
                type="button"
                className="btn ghost sm"
                aria-label={`${ACTION_LABEL[action]} exception ${row.breakKey}`}
                onClick={() => {
                  setDialogError(undefined);
                  setPending({ row, action });
                }}
              >
                {ACTION_LABEL[action]}
              </button>
            ))}
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
      <DataTable<ExceptionRow>
        columns={columns}
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
        busy={busy}
        errorMessage={dialogError}
        description={
          pending ? (
            <>
              {ACTION_LABEL[pending.action]} exception <strong>{pending.row.breakKey}</strong> ({pending.row.breakType}
              {pending.row.field ? `, field "${pending.row.field}"` : ""}) from provider{" "}
              <strong>{pending.row.provider}</strong>.
            </>
          ) : null
        }
        onConfirm={() => void runAction()}
        onCancel={() => !busy && setPending(null)}
      />
    </>
  );
}
