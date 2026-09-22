"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, DataTable, ConfirmDialog } from "../../../../_components/ds";
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
  const t = useTranslations("loansTable");
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
      setMessage(t("disbursedMessage"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
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
    { key: "loanNo", label: t("colLoanNo") },
    { key: "loanType", label: t("colType") },
    { key: "principalMinor", label: t("colPrincipal"), align: "right", cellType: "amount" },
    { key: "outstandingMinor", label: t("colOutstanding"), align: "right", cellType: "amount" },
    { key: "emiMinor", label: t("colEmi"), align: "right", cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
    {
      key: "id",
      label: t("colAction"),
      render: (row) =>
        row.status === "applied" ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={t("disburseAriaLabel", { loanNo: row.loanNo })}
            onClick={() => {
              setError(undefined);
              setPendingId(row.id);
            }}
          >
            {t("disburseButton")}
          </Button>
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
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        emptyIcon="💳"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />

      <ConfirmDialog
        open={!!pendingId}
        title={t("confirmTitle")}
        danger
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        description={t.rich("confirmDescription", {
          loanNo: pendingLoan?.loanNo ?? "",
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => pendingId && void disburse(pendingId)}
        onCancel={() => !busy && setPendingId(null)}
      />
    </div>
  );
}
