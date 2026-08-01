"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card, DataTable, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatIndianDate } from "@/lib/formatters";

export type FiscalYearRow = {
  code: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
};

type DisplayRow = FiscalYearRow & {
  startDateDisplay: string;
  endDateDisplay: string;
  /** Synthetic column key for the row-action cell; value unused (render overrides). */
  action: string;
};

export function FiscalYearsTable({ rows }: { rows: FiscalYearRow[] }) {
  const router = useRouter();
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const pendingYear = rows.find((r) => r.code === pendingCode) ?? null;

  async function activate(code: string) {
    setBusy(true);
    setError(undefined);
    try {
      await browserJson(`v1/finance/fiscal-years/${encodeURIComponent(code)}/activate`, {
        method: "PATCH",
      });
      setPendingCode(null);
      setMessage(`Fiscal year ${code} is now active.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const displayRows: DisplayRow[] = rows.map((r) => ({
    ...r,
    startDateDisplay: formatIndianDate(r.startDate),
    endDateDisplay: formatIndianDate(r.endDate),
    action: r.code,
  }));

  const columns: {
    key: keyof DisplayRow & string;
    label: string;
    cellType?: "status";
    render?: (row: DisplayRow) => ReactNode;
  }[] = [
    { key: "code", label: "Code" },
    { key: "label", label: "Label" },
    { key: "startDateDisplay", label: "Start Date" },
    { key: "endDateDisplay", label: "End Date" },
    { key: "status", label: "Status", cellType: "status" },
    {
      key: "action",
      label: "Action",
      render: (row) =>
        row.status === "active" ? (
          <span style={{ color: "var(--mut)", fontSize: 12 }}>Currently active</span>
        ) : (
          <button
            type="button"
            className="btn secondary sm"
            aria-label={`Activate fiscal year ${row.code}`}
            onClick={() => {
              setError(undefined);
              setPendingCode(row.code);
            }}
          >
            Activate
          </button>
        ),
    },
  ];

  return (
    <Card title="Fiscal Years">
      {message && (
        <p role="status" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>
          {message}
        </p>
      )}
      <DataTable<DisplayRow>
        columns={columns}
        rows={displayRows}
        sortable
        filterable
        filterPlaceholder="Filter by code or label…"
        pageSize={15}
        emptyIcon="📅"
        emptyTitle="No fiscal years yet"
        emptyMessage="Create the first fiscal year using the form above."
      />

      <ConfirmDialog
        open={!!pendingCode}
        title="Activate this fiscal year?"
        confirmLabel="Activate fiscal year"
        busy={busy}
        errorMessage={error}
        description={
          <>
            Set fiscal year <strong>{pendingYear?.label ?? pendingCode}</strong> as active. The currently active
            fiscal year, if any, will be closed. This changes which year new postings apply to.
          </>
        }
        onConfirm={() => pendingCode && void activate(pendingCode)}
        onCancel={() => !busy && setPendingCode(null)}
      />
    </Card>
  );
}
