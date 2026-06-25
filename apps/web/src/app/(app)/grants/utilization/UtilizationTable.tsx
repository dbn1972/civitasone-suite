"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, ActionButton } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import type { GrantUtilization } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Col = {
  key: keyof GrantUtilization & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GrantUtilization) => ReactNode;
};

async function postAction(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Action failed (${res.status}). ${txt.slice(0, 200) || "No response body."}`);
  }
}

export function UtilizationTable({ ucs, source = "api" }: { ucs: GrantUtilization[]; source?: "api" | "error" }) {
  const router = useRouter();
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GrantUtilization[]>(
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
      render: (row) =>
        row.status === "submitted" || row.status === "pending" ? (
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
              onConfirm={async (reason) => {
                await postAction(`/api/proxy/v1/grants/utilization-certs/${row.id}/validate`, {
                  status: "rejected",
                  remarks: reason,
                });
                router.refresh();
              }}
            />
          </span>
        ) : (
          <span aria-hidden="true">—</span>
        ),
    },
  ];

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${formatIndianDate(new Date(cachedAt).toISOString())}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<GrantUtilization> columns={columns} rows={rows} sortable filterable filterPlaceholder="Filter UCs…" pageSize={15} />
    </>
  );
}
