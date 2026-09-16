"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

export type PeriodRow = {
  period: string;
  fiscalYear: string;
  status: string;
  closedBy: string | null;
  closedAt: string | null;
} & Record<string, unknown>;

type DisplayRow = PeriodRow & {
  /** Synthetic column key for the row-action cell; value unused (render overrides). */
  actions: string;
};

type PeriodAction = "close" | "hard-close" | "reopen";

const ACTION_LABEL: Record<PeriodAction, string> = {
  close: "Soft-close",
  "hard-close": "Hard-close",
  reopen: "Reopen",
};

// Mirrors the period-close state machine in finance-service
// (services/finance-service/src/modules/period-close/routes.ts) — only the
// transitions valid for the period's current status are offered.
const AVAILABLE_ACTIONS: Record<string, PeriodAction[]> = {
  open: ["close", "hard-close"],
  soft_close: ["hard-close", "reopen"],
  hard_close: ["reopen"],
};

/**
 * Plain-language fallback for a period-action network exception (no Response
 * to read). toHumanError is the same catalogued-message building block
 * errorMessageFromResponse (used below for the failed-response path) is
 * built on -- never a raw exception message. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016/UX-020.
 */
function periodActionExceptionMessage(): string {
  const human = toHumanError("save", { area: "period action" });
  return `${human.what} ${human.next}`;
}

export function PeriodsTable({ periods, canReopen = false }: { periods: PeriodRow[]; canReopen?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<{ row: PeriodRow; action: PeriodAction } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function runAction(reason?: string) {
    if (!pending) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserFetch(`v1/finance/periods/${encodeURIComponent(pending.row.period)}/${pending.action}`, {
        method: "POST",
        body: pending.action === "reopen" ? JSON.stringify({ reason }) : undefined,
      });
      if (!res.ok) {
        setDialogError(await errorMessageFromResponse(res, "save", "period action"));
        return;
      }
      setMessage(`Period ${pending.row.period}: ${ACTION_LABEL[pending.action].toLowerCase()} applied.`);
      setPending(null);
      router.refresh();
    } catch {
      setDialogError(periodActionExceptionMessage());
    } finally {
      setBusy(false);
    }
  }

  const displayRows: DisplayRow[] = periods.map((p) => ({ ...p, actions: p.period }));

  const columns = [
    { key: "period" as const, label: "Period", render: (row: DisplayRow) => <span className="mono">{row.period}</span> },
    { key: "fiscalYear" as const, label: "Fiscal Year", render: (row: DisplayRow) => row.fiscalYear || "—" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
    { key: "closedBy" as const, label: "Closed By", render: (row: DisplayRow) => row.closedBy ?? "—" },
    { key: "closedAt" as const, label: "Closed At", render: (row: DisplayRow) => (row.closedAt ? formatIndianDate(row.closedAt) : "—") },
    {
      key: "actions" as const,
      label: "Actions",
      sortable: false,
      render: (row: DisplayRow) => {
        const actions = (AVAILABLE_ACTIONS[row.status] ?? []).filter((a) => a !== "reopen" || canReopen);
        if (actions.length === 0) {
          return <span style={{ color: "var(--ink2)", fontSize: 13 }}>—</span>;
        }
        return (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                className={`btn ${action === "hard-close" ? "danger" : "ghost"} sm`}
                aria-label={`${ACTION_LABEL[action]} period ${row.period}`}
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

  const dialogCopy = (() => {
    if (!pending) return null;
    const { row, action } = pending;
    if (action === "close") {
      return (
        <>
          Soft-close period <strong>{row.period}</strong>. Postings will be flagged for review; the period can still
          be hard-closed or left as-is. This can be undone by reopening the period.
        </>
      );
    }
    if (action === "hard-close") {
      return (
        <>
          Hard-close period <strong>{row.period}</strong>. No further postings will be accepted for this period, and
          this action <strong>cannot be undone</strong> from this screen — reversing it requires a Finance Admin to
          explicitly reopen the period, which is separately audit-logged. Existing unposted vouchers in this period
          are <strong>not</strong> automatically rejected by the server — reconcile, post, or cancel them first, or
          they will be left stranded in this period once it is closed.
        </>
      );
    }
    return (
      <>
        Reopen period <strong>{row.period}</strong>, currently{" "}
        <strong>{row.status === "hard_close" ? "hard-closed" : "soft-closed"}</strong>. This restores posting access
        for the period and is restricted to Finance Admins; the reopening is recorded in the period reopen log.
      </>
    );
  })();

  return (
    <>
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
        filterPlaceholder="Filter by period, fiscal year, or status…"
        pageSize={15}
        emptyIcon="🗓️"
        emptyTitle="No periods tracked yet"
        emptyMessage="Close a period above to start tracking its lifecycle here."
      />

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `${ACTION_LABEL[pending.action]} period ${pending.row.period}?` : ""}
        confirmLabel={pending ? ACTION_LABEL[pending.action] : "Confirm"}
        danger={pending?.action === "hard-close" || pending?.action === "reopen"}
        requireReason={pending?.action === "reopen"}
        reasonLabel="Reason for reopening"
        busy={busy}
        errorMessage={dialogError}
        description={dialogCopy}
        onConfirm={(reason) => void runAction(reason)}
        onCancel={() => !busy && setPending(null)}
      />
    </>
  );
}
