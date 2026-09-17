"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, ActionButton } from "@/app/_components/ds";
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
 * message/error text or the raw HTTP status. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
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

export function InstallmentsTable({ installments, source = "api" }: { installments: GrantInstallmentSummary[]; source?: "api" | "error" }) {
  const router = useRouter();
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GrantInstallmentSummary[]>(
    "grants.installments",
    installments,
    source,
    (d) => d.length === 0,
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
      render: (row) =>
        row.status === "pending" ? (
          <ActionButton
            label="Release"
            className="btn primary sm"
            confirmTitle={`Release installment #${row.installmentNo}?`}
            confirmDescription={
              <>
                This initiates disbursement of <strong>{formatMoney(row.amount)}</strong> to{" "}
                <strong>{row.granteeName}</strong> (mode: PFMS) and cannot be undone. A reason is
                recorded in the audit trail.
              </>
            }
            confirmLabel="Release funds"
            requireReason
            reasonLabel="Reason / approval reference (required)"
            onConfirm={async (reason) => {
              await postAction(`/api/proxy/v1/grants/installments/${row.id}/disburse`, {
                mode: "PFMS",
                beneficiaryBankRef: reason,
              });
              router.refresh();
            }}
          />
        ) : (
          <span aria-hidden="true">—</span>
        ),
    },
  ];

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<GrantInstallmentSummary> columns={columns} rows={rows} sortable filterable filterPlaceholder="Filter installments…" pageSize={15} />
    </>
  );
}
