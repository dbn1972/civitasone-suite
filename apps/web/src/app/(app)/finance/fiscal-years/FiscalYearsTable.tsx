"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, DataTable, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatIndianDate } from "@/lib/formatters";
import type { PeriodRow } from "../period-close/periodsLoader";

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

/**
 * `periods` / `periodsUnavailable` feed the activation check
 * (GAP-FINANCE-FISCAL-YEARS-02): periods of the outgoing year that are still
 * open or only soft-closed are listed in the dialog with a link to the
 * period-close cockpit. It warns rather than blocks -- whether activation must
 * be refused while periods are open is a finance-owner decision.
 */
export function FiscalYearsTable({
  rows,
  periods = [],
  periodsUnavailable = false,
}: {
  rows: FiscalYearRow[];
  periods?: PeriodRow[];
  periodsUnavailable?: boolean;
}) {
  const router = useRouter();
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const pendingYear = rows.find((r) => r.code === pendingCode) ?? null;
  const outgoing = rows.find((r) => r.status === "active") ?? null;
  const unclosed = outgoing
    ? periods.filter((p) => p.fiscalYear === outgoing.code && p.status !== "hard_close")
    : [];

  async function activate(code: string, reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      await browserJson(`v1/finance/fiscal-years/${encodeURIComponent(code)}/activate`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={`Activate fiscal year ${row.code}`}
            onClick={() => {
              setError(undefined);
              setPendingCode(row.code);
            }}
          >
            Activate
          </Button>
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
        danger
        requireReason
        reasonLabel="Reason for switching the posting year"
        minReasonLength={10}
        maxReasonLength={500}
        busy={busy}
        errorMessage={error}
        description={
          <>
            Set fiscal year <strong>{pendingYear?.label ?? pendingCode}</strong> as active.{" "}
            {outgoing ? (
              <>Fiscal year <strong>{outgoing.code}</strong> will be closed. </>
            ) : null}
            This changes which year every new posting applies to; your reason is recorded in the audit trail.
            {outgoing && unclosed.length > 0 ? (
              <span role="note" style={{ display: "block", marginTop: 8, color: "var(--warn, #b45309)" }}>
                ⚠ {unclosed.length} period{unclosed.length === 1 ? "" : "s"} of {outgoing.code} not hard-closed:{" "}
                {unclosed.map((p) => `${p.period} (${p.status === "soft_close" ? "soft-closed" : "open"})`).join(", ")}.{" "}
                <a href="/finance/period-close">Review period close</a>
              </span>
            ) : null}
            {periodsUnavailable ? (
              <span role="note" style={{ display: "block", marginTop: 8, color: "var(--warn, #b45309)" }}>
                ⚠ Period status couldn&apos;t be checked. <a href="/finance/period-close">Review period close</a> before switching.
              </span>
            ) : null}
            {pendingCode ? (
              <span style={{ display: "block", marginTop: 8 }}>
                Confirm the <a href={`/finance/opening-balances?fy=${encodeURIComponent(pendingCode)}`}>opening balances for {pendingCode}</a> are entered.
              </span>
            ) : null}
          </>
        }
        onConfirm={(reason) => pendingCode && void activate(pendingCode, reason)}
        onCancel={() => !busy && setPendingCode(null)}
      />
    </Card>
  );
}
