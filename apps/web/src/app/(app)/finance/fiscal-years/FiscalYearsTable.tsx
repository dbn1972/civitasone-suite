"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, DataTable, ConfirmDialog } from "../../../_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
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
 * period-close cockpit. finance-service REFUSES activation while any month of
 * the outgoing year is not hard-closed (per-tenant setting, default on), so the
 * dialog explains the block; the server is the authority.
 *
 * `secondApprover` (default on): activation is submitted as a request that a
 * different finance administrator approves (GAP-FINANCE-FISCAL-YEARS-01/-02);
 * `pendingCodes` are the years that already have such a request.
 */
export function FiscalYearsTable({
  rows,
  periods = [],
  periodsUnavailable = false,
  secondApprover = true,
  pendingCodes = [],
}: {
  rows: FiscalYearRow[];
  periods?: PeriodRow[];
  periodsUnavailable?: boolean;
  secondApprover?: boolean;
  pendingCodes?: string[];
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
      const res = await browserFetch(`v1/finance/fiscal-years/${encodeURIComponent(code)}/activate`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        // Known refusals get their own plain-language copy; anything else is the generic save error.
        const known = await errorCodeFromResponse(res);
        if (known === "FY_OPEN_PERIODS") setError(`Fiscal year ${outgoing?.code ?? "in use"} still has months that are not hard-closed. Hard-close them in Period Close, then try again.`);
        else if (known === "FY_OPENING_BALANCES_MISSING") setError(`Enter the opening balances for ${code} before activating it.`);
        else if (known === "CHANGE_REQUEST_PENDING") setError(`Activation of ${code} is already waiting for approval.`);
        else if (known === "ALREADY_ACTIVE") setError(`Fiscal year ${code} is already active.`);
        else setError(await errorMessageFromResponse(res, "save", "fiscal year"));
        return;
      }
      const body = (await res.json().catch(() => null)) as { status?: string } | null;
      setPendingCode(null);
      setMessage(
        body?.status === "pending_approval"
          ? `Activation of ${code} was submitted. It takes effect when a different finance administrator approves it below.`
          : `Activation of ${code} was submitted. It becomes the active year in a moment.`,
      );
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
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
        ) : pendingCodes.includes(row.code) ? (
          <span style={{ color: "var(--mut)", fontSize: 12 }}>Awaiting approval</span>
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
        confirmLabel={secondApprover ? "Submit for approval" : "Activate fiscal year"}
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
            {secondApprover ? (
              <span style={{ display: "block", marginTop: 8 }}>
                <strong>A different finance administrator must approve this</strong> before it takes effect. Until then {outgoing ? outgoing.code : "the current year"} stays active.
              </span>
            ) : null}
            {outgoing && unclosed.length > 0 ? (
              <span role="note" style={{ display: "block", marginTop: 8, color: "var(--warn, #b45309)" }}>
                ⚠ Activation is blocked: {unclosed.length} period{unclosed.length === 1 ? "" : "s"} of {outgoing.code} not hard-closed:{" "}
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
