"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, DataTable, ConfirmDialog } from "../../../../_components/ds";
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

// UX-017: this component is not currently imported anywhere as JSX -- confirmed
// via a fleet-wide grep for "<OffCycleList" (the only match is this file's own
// test); off-cycle/page.tsx imports `OffCycleList` as a value but only ever
// renders `OffCycleCards` instead, using this file's co-exported `OffCycleRow`
// type. Same situation as tranche 9's `BankFileForm.tsx`: left in place
// (deleting dead code is a separate, out-of-scope decision) but still
// translated, since it is still reachable by its own test and any future
// re-wiring, and leaving hardcoded English text in it would not serve this
// gap's "0 findings" goal for the off-cycle/ slice.
export function OffCycleList({ rows }: { rows: OffCycleRow[] }) {
  const t = useTranslations("offCycleList");
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
      setMessage(t("processedMessage", { period: pendingRow.period, amount: formatMoney(res.data.totalNetMinor) }));
      setPendingRow(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: "run_type" as const, label: t("colRunType") },
    { key: "period" as const, label: t("colPeriod") },
    { key: "description" as const, label: t("colDescription") },
    { key: "total_amount_minor" as const, label: t("colTotalAmount"), align: "right" as const, cellType: "amount" as const },
    { key: "total_tax_minor" as const, label: t("colTotalTax"), align: "right" as const, cellType: "amount" as const },
    { key: "total_net_minor" as const, label: t("colTotalNet"), align: "right" as const, cellType: "amount" as const },
    { key: "status" as const, label: t("colStatus"), cellType: "status" as const },
    {
      key: "id" as const,
      label: t("colAction"),
      sortable: false,
      render: (row: OffCycleRow) =>
        row.status === "draft" ? (
          <Button
            type="button"
            variant="primary"
            style={{ minHeight: 36 }}
            aria-label={t("processAriaLabel", { runType: row.run_type, period: row.period })}
            onClick={() => {
              setDialogError(undefined);
              setPendingRow(row);
            }}
          >
            {t("processBtn")}
          </Button>
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
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        emptyIcon="🗂️"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />

      <ConfirmDialog
        open={pendingRow !== null}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={
          pendingRow ? (
            t.rich("confirmDescription", {
              runType: pendingRow.run_type,
              period: pendingRow.period,
              amount: formatMoney(pendingRow.total_amount_minor),
              strong: (chunks) => <strong>{chunks}</strong>,
            })
          ) : null
        }
        onConfirm={() => void processRun()}
        onCancel={() => !busy && setPendingRow(null)}
      />
    </>
  );
}
