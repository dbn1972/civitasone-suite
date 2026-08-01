"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

export type OffCycleRow = {
  id: string;
  run_type: string;
  period: string;
  description: string | null;
  total_amount_minor: number | string;
  total_tax_minor: number | string | null;
  total_net_minor: number | string | null;
  status: string;
  created_at: string;
} & Record<string, unknown>;

type ProcessResponse = {
  data: { id: string; status: string; totalTaxMinor: number; totalNetMinor: number };
};

export function OffCycleList({ rows }: { rows: OffCycleRow[] }) {
  const router = useRouter();
  const [pendingRow, setPendingRow] = useState<OffCycleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function processRun() {
    if (!pendingRow) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<ProcessResponse>(`v1/payroll/off-cycle/${pendingRow.id}/process`, {
        method: "POST",
      });
      setMessage(
        `Off-cycle run for ${pendingRow.period} processed. Net payable ${formatMoney(res.data.totalNetMinor)}.`,
      );
      setPendingRow(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: "run_type" as const, label: "Run Type" },
    { key: "period" as const, label: "Period" },
    { key: "description" as const, label: "Description" },
    { key: "total_amount_minor" as const, label: "Total Amount", align: "right" as const, cellType: "amount" as const },
    { key: "total_tax_minor" as const, label: "Total Tax", align: "right" as const, cellType: "amount" as const },
    { key: "total_net_minor" as const, label: "Total Net", align: "right" as const, cellType: "amount" as const },
    { key: "status" as const, label: "Status", cellType: "status" as const },
    {
      key: "id" as const,
      label: "Action",
      sortable: false,
      render: (row: OffCycleRow) =>
        row.status === "draft" ? (
          <button
            type="button"
            className="btn"
            style={{ minHeight: 36 }}
            aria-label={`Process ${row.run_type} off-cycle run for ${row.period}`}
            onClick={() => {
              setDialogError(undefined);
              setPendingRow(row);
            }}
          >
            Process
          </button>
        ) : (
          <span style={{ color: "var(--ink2)", fontSize: 13 }}>—</span>
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
      <DataTable<OffCycleRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter by period or run type…"
        pageSize={15}
        emptyIcon="🗂️"
        emptyTitle="No off-cycle runs yet"
        emptyMessage="Create an off-cycle run using the form above."
      />

      <ConfirmDialog
        open={pendingRow !== null}
        title="Process this off-cycle run?"
        confirmLabel="Process run"
        busy={busy}
        errorMessage={dialogError}
        description={
          pendingRow ? (
            <>
              Process the {pendingRow.run_type} off-cycle run for period <strong>{pendingRow.period}</strong>,
              total {formatMoney(pendingRow.total_amount_minor)}. This computes tax and net payable for every
              item and is irreversible.
            </>
          ) : null
        }
        onConfirm={() => void processRun()}
        onCancel={() => !busy && setPendingRow(null)}
      />
    </>
  );
}
