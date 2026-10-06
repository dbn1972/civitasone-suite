"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, ActionButton, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { GrantUtilization } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Col = {
  key: keyof GrantUtilization & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GrantUtilization) => ReactNode;
};

/**
 * Minimum rejection/verification remark length — kept in parity with the
 * application rejection control (applications/[id]/ApplicationActions.tsx uses
 * 10). GAP-GRANTS-UTILIZATION-04.
 */
const REASON_MIN = 10;
const REASON_MAX = 1000;

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

export function UtilizationTable({
  ucs,
  source = "api",
  canVerify = false,
}: {
  ucs: GrantUtilization[];
  source?: "api" | "error";
  /** GAP-GRANTS-UTILIZATION-01: only a checker role gets Verify/Reject. */
  canVerify?: boolean;
}) {
  const router = useRouter();
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GrantUtilization[]>(
    "grants.utilization",
    ucs,
    source,
    (d) => d.length === 0,
  );

  const columns: Col[] = [
    { key: "ucNo", label: "UC No" },
    { key: "grantNo", label: "Grant No" },
    { key: "granteeName", label: "Grantee" },
    { key: "amount", label: "Amount", align: "right", render: (row) => formatMoney(row.amount) },
    { key: "periodFrom", label: "Period From", render: (row) => formatIndianDate(row.periodFrom) },
    { key: "periodTo", label: "Period To", render: (row) => formatIndianDate(row.periodTo) },
    {
      key: "submittedDate",
      label: "Submitted Date",
      render: (row) => (row.submittedDate ? formatIndianDate(row.submittedDate) : "—"),
    },
    { key: "status", label: "Status", render: (row) => <StatusPill status={row.status} /> },
    {
      key: "id",
      label: "Action",
      align: "right",
      render: (row) => {
        // GAP-GRANTS-UTILIZATION-01: no action column for non-checkers.
        // GAP-GRANTS-UTILIZATION-03: only a UC the grantee has actually filed
        // ("submitted" AND with a submitted date) can be verified — a "pending"
        // (not-yet-filed) UC must not be certifiable from the UI.
        const canAct = canVerify && row.status === "submitted" && Boolean(row.submittedDate);
        if (!canAct) {
          return <span aria-hidden="true">—</span>;
        }
        return (
          <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
            <ActionButton
              label="Verify"
              className="btn primary sm"
              confirmTitle={`Verify UC ${row.ucNo}?`}
              confirmDescription={
                <>
                  Verifying confirms utilisation of <strong>{formatMoney(row.amount)}</strong> by{" "}
                  <strong>{row.granteeName}</strong> as per GFR 2017. Recorded in the audit trail.
                </>
              }
              confirmLabel="Verify UC"
              requireReason
              reasonLabel="Verification remarks (required)"
              minReasonLength={REASON_MIN}
              maxReasonLength={REASON_MAX}
              onConfirm={async (reason) => {
                await postAction(`/api/proxy/v1/grants/utilization-certs/${row.id}/validate`, {
                  status: "validated",
                  remarks: reason,
                });
                router.refresh();
              }}
            />
            <ActionButton
              label="Reject"
              className="btn danger sm"
              danger
              confirmTitle={`Reject UC ${row.ucNo}?`}
              confirmDescription={
                <>
                  Rejecting returns UC <strong>{row.ucNo}</strong> to <strong>{row.granteeName}</strong>{" "}
                  for correction. A reason is mandatory and recorded in the audit trail.
                </>
              }
              confirmLabel="Reject UC"
              requireReason
              reasonLabel="Reason for rejection (required)"
              minReasonLength={REASON_MIN}
              maxReasonLength={REASON_MAX}
              onConfirm={async (reason) => {
                await postAction(`/api/proxy/v1/grants/utilization-certs/${row.id}/validate`, {
                  status: "rejected",
                  remarks: reason,
                });
                router.refresh();
              }}
            />
          </span>
        );
      },
    },
  ];

  // GAP-GRANTS-UTILIZATION-05: a failed fetch with no cache shows a retry state,
  // not an empty table + four zeros.
  if (provenance === "error-no-data" && rows.length === 0) {
    return (
      <RefreshErrorState
        error={toHumanError("load", { area: "utilisation certificates" })}
        backHref="/grants"
        source={{ area: "utilisation certificates" }}
      />
    );
  }

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<GrantUtilization> columns={columns} rows={rows} sortable filterable filterPlaceholder="Filter UCs…" pageSize={15} />
    </>
  );
}
