"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, ActionButton, Select } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { GrantInstallmentSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Col = {
  key: keyof GrantInstallmentSummary & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GrantInstallmentSummary) => ReactNode;
};

/**
 * Plain-language failure message for a failed installment disbursement.
 * postAction is a plain async helper, not a component or hook, so it can't
 * call the useFormError hook; toHumanError is the same catalogued-message
 * building block that hook is built on -- never the backend's own
 * message/error text or the raw HTTP status.
 */
function grantActionError(): string {
  const human = toHumanError("save", { area: "grant action" });
  return `${human.what} ${human.next}`;
}

async function postAction(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(grantActionError());
  }
}

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "released", label: "Released" },
  { value: "utilized", label: "Utilised" },
];

export function InstallmentsTable({
  installments,
  source = "api",
  canRelease = false,
}: {
  installments: GrantInstallmentSummary[];
  source?: "api" | "error";
  canRelease?: boolean;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GrantInstallmentSummary[]>(
    "grants.installments",
    installments,
    source,
    (d) => d.length === 0,
  );

  // GAP-GRANTS-INSTALLMENTS-03: a release must follow installment sequence —
  // #3 cannot be released while #2 is still pending. Compute, per grant, the
  // lowest pending installmentNo; only that installment is releasable. This is
  // a client convenience guard; the grant-service remains the authority and
  // must reject an out-of-order or suspended-grant release server-side.
  const lowestPendingByGrant = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== "pending") continue;
      const current = map.get(r.grantId);
      if (current === undefined || r.installmentNo < current) {
        map.set(r.grantId, r.installmentNo);
      }
    }
    return map;
  }, [rows]);

  const visibleRows = useMemo(
    () => (statusFilter ? rows.filter((r) => r.status === statusFilter) : rows),
    [rows, statusFilter],
  );

  const columns: Col[] = [
    { key: "grantNo", label: "Grant No" },
    { key: "granteeName", label: "Grantee" },
    { key: "installmentNo", label: "Installment #", align: "right" },
    { key: "amount", label: "Amount", align: "right", render: (row) => formatMoney(row.amount) },
    { key: "scheduledDate", label: "Scheduled Date", render: (row) => formatIndianDate(row.scheduledDate) },
    {
      key: "releasedDate",
      label: "Released Date",
      render: (row) => (row.releasedDate ? formatIndianDate(row.releasedDate) : "—"),
    },
    { key: "status", label: "Status", render: (row) => <StatusPill status={row.status} /> },
    {
      key: "id",
      label: "Action",
      align: "right",
      render: (row) => {
        // GAP-GRANTS-INSTALLMENTS-01: only maker roles see the Release control.
        if (!canRelease) return <span aria-hidden="true">—</span>;
        if (row.status !== "pending") return <span aria-hidden="true">—</span>;
        // GAP-GRANTS-INSTALLMENTS-03: out-of-sequence installments are not releasable.
        const isLowestPending = lowestPendingByGrant.get(row.grantId) === row.installmentNo;
        if (!isLowestPending) {
          return (
            <span className="muted" title="Release earlier installments of this grant first.">
              Blocked
            </span>
          );
        }
        return (
          <ActionButton
            label="Release"
            className="btn primary sm"
            confirmTitle={`Release installment #${row.installmentNo}?`}
            confirmDescription={
              <>
                This initiates disbursement of <strong>{formatMoney(row.amount)}</strong> to{" "}
                <strong>{row.granteeName}</strong> (mode: PFMS) and cannot be undone. The payee
                account is resolved server-side from the grantee&rsquo;s registered bank account; a
                reason is recorded in the audit trail.
              </>
            }
            confirmLabel="Release funds"
            requireReason
            reasonLabel="Reason / approval reference (required)"
            onConfirm={async (reason) => {
              // GAP-GRANTS-INSTALLMENTS-02: the approval reason is sent as
              // `reason` (audited), NOT as beneficiaryBankRef. The payee bank
              // reference is resolved server-side from the grantee master; it
              // must never carry a free-text clerk reason.
              await postAction(`/api/proxy/v1/grants/installments/${row.id}/disburse`, {
                mode: "PFMS",
                reason,
              });
              router.refresh();
            }}
          />
        );
      },
    },
  ];

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {/* GAP-GRANTS-INSTALLMENTS-06: a status select filter alongside the
          free-text filter. */}
      <div style={{ marginBottom: 12, maxWidth: 220 }}>
        <Select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <DataTable<GrantInstallmentSummary>
        columns={columns}
        rows={visibleRows}
        sortable
        filterable
        filterPlaceholder="Filter installments…"
        pageSize={15}
      />
    </>
  );
}
