"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, ActionButton } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import type { GrantRelease } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Col = {
  key: keyof GrantRelease & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GrantRelease) => ReactNode;
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

export function ReleasesTable({ releases, source = "api" }: { releases: GrantRelease[]; source?: "api" | "error" }) {
  const router = useRouter();
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GrantRelease[]>(
    "grants.releases",
    releases,
    source,
    (d) => d.length === 0,
  );

  const columns: Col[] = [
    { key: "releaseNo", label: "Release No" },
    { key: "grantNo", label: "Grant No" },
    { key: "granteeName", label: "Grantee" },
    { key: "amount", label: "Amount", align: "right", render: (row) => formatMoney(row.amount) },
    { key: "releaseDate", label: "Release Date", render: (row) => formatIndianDate(row.releaseDate) },
    { key: "bankRef", label: "Bank Ref", render: (row) => row.bankRef ?? "—" },
    { key: "status", label: "Status", render: (row) => <StatusPill status={row.status} /> },
    {
      key: "id",
      label: "Action",
      align: "right",
      render: (row) =>
        row.status === "pending" ? (
          <ActionButton
            label="Approve"
            className="btn primary sm"
            confirmTitle={`Approve release ${row.releaseNo}?`}
            confirmDescription={
              <>
                This approves the fund release of <strong>{formatMoney(row.amount)}</strong> to{" "}
                <strong>{row.granteeName}</strong> and cannot be undone. A reason is recorded in the
                audit trail.
              </>
            }
            confirmLabel="Approve release"
            requireReason
            reasonLabel="Approval reference / reason (required)"
            onConfirm={async (reason) => {
              // NOTE: grant-service exposes GET /v1/grants/releases (read-only);
              // there is no release-approve write endpoint yet. This POST will
              // surface the gateway's response (e.g. 404/405) until the backend
              // adds it. The real maker action today is "Release" on the grant's
              // installment (POST .../installments/:id/disburse).
              await postAction(`/api/proxy/v1/grants/releases/${row.id}/approve`, {
                reason,
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
      <DataTable<GrantRelease> columns={columns} rows={rows} sortable filterable filterPlaceholder="Filter releases…" pageSize={15} />
    </>
  );
}
