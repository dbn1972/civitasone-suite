"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

export type LoanRow = {
  id: string;
  loanNo: string;
  loanType: string;
  principalMinor: string | number;
  outstandingMinor: string | number;
  emiMinor: string | number;
  tenureMonths: number;
  status: string;
} & Record<string, unknown>;

export function LoansTable({ rows }: { rows: LoanRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const pendingLoan = rows.find((r) => r.id === pendingId) ?? null;

  async function disburse(id: string) {
    setBusy(true);
    setError(undefined);
    try {
      await browserJson(`v1/payroll/loans/${id}/disburse`, { method: "PATCH" });
      setPendingId(null);
      setMessage("Loan disbursement queued.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const columns: {
    key: keyof LoanRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "status" | "amount";
    render?: (row: LoanRow) => React.ReactNode;
  }[] = [
    { key: "loanNo", label: "Loan No." },
    { key: "loanType", label: "Type" },
    { key: "principalMinor", label: "Principal", align: "right", cellType: "amount" },
    { key: "outstandingMinor", label: "Outstanding", align: "right", cellType: "amount" },
    { key: "emiMinor", label: "EMI", align: "right", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
    {
      key: "id",
      label: "Action",
      render: (row) =>
        row.status === "applied" ? (
          <button
            type="button"
            className="btn secondary sm"
            aria-label={`Disburse loan ${row.loanNo}`}
            onClick={() => {
              setError(undefined);
              setPendingId(row.id);
            }}
          >
            Disburse
          </button>
        ) : (
          <span style={{ color: "var(--mut)", fontSize: 12 }}>—</span>
        ),
    },
  ];

  return (
    <div>
      {message && (
        <p role="status" className="pill good" style={{ marginBottom: 10, width: "fit-content" }}>
          {message}
        </p>
      )}
      <DataTable<LoanRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter by loan no. or type…"
        pageSize={15}
        emptyIcon="💳"
        emptyTitle="No loans for this employee"
        emptyMessage="This employee has no loans on record."
      />

      <ConfirmDialog
        open={!!pendingId}
        title="Disburse this loan?"
        danger
        confirmLabel="Disburse loan"
        busy={busy}
        errorMessage={error}
        description={
          <>
            This releases funds for loan <strong>{pendingLoan?.loanNo}</strong>. This action is
            irreversible.
          </>
        }
        onConfirm={() => pendingId && void disburse(pendingId)}
        onCancel={() => !busy && setPendingId(null)}
      />
    </div>
  );
}
