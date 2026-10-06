"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, ActionButton } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { GrantRelease } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

/**
 * GAP-GRANTS-RELEASES-02: the release-approve endpoint does not exist in
 * grant-service yet (GET /v1/grants/releases is read-only). An Approve button
 * that posts to a missing endpoint would confirm a "cannot be undone" dialog,
 * take a reason, and then fail with a generic error — i.e. fake a money-release
 * approval. Keep the control hidden behind an explicit opt-in flag until the
 * backend ships the write endpoint (then flip the env + keep the ActionButton).
 */
const APPROVE_ENABLED = process.env.NEXT_PUBLIC_GRANTS_RELEASE_APPROVE === "1";

type Col = {
  key: keyof GrantRelease & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GrantRelease) => ReactNode;
};

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

export function ReleasesTable({
  releases,
  source = "api",
  canApprove = false,
}: {
  releases: GrantRelease[];
  source?: "api" | "error";
  canApprove?: boolean;
}) {
  const router = useRouter();
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GrantRelease[]>(
    "grants.releases",
    releases,
    source,
    (d) => d.length === 0,
  );

  // GAP-GRANTS-RELEASES-01 + 02: the Approve column only exists when BOTH the
  // backend endpoint is enabled AND the viewer holds an approver role. Until
  // the endpoint ships (flag off) it is omitted for everyone — never faked.
  const showApprove = APPROVE_ENABLED && canApprove;

  const columns: Col[] = [
    { key: "releaseNo", label: "Release No" },
    { key: "grantNo", label: "Grant No" },
    { key: "granteeName", label: "Grantee" },
    // GAP-GRANTS-RELEASES-03 / DISBURSEMENTS-DETAIL-02 (money unit):
    // GrantRelease.amount is MINOR units (paise) on the wire (grant-service
    // listGrantReleases passes amount_minor through unchanged). Render with
    // formatMoney so this list matches the disbursement detail page (also
    // formatMoney) — no formatRupees, no 100x drift either way.
    { key: "amount", label: "Amount", align: "right", render: (row) => formatMoney(row.amount) },
    { key: "releaseDate", label: "Release Date", render: (row) => formatIndianDate(row.releaseDate) },
    {
      key: "bankRef",
      label: "Bank Ref",
      // GAP-GRANTS-RELEASES-06: a pending release has no bank ref yet — say so
      // rather than a bare "—" that reads like missing data.
      render: (row) =>
        row.bankRef ? row.bankRef : row.status === "pending" ? <span className="muted">Awaiting bank ref</span> : "—",
    },
    { key: "status", label: "Status", render: (row) => <StatusPill status={row.status} /> },
    ...(showApprove
      ? [
          {
            key: "id" as const,
            label: "Action",
            align: "right" as const,
            render: (row: GrantRelease) =>
              row.status === "pending" ? (
                <ActionButton
                  label="Approve"
                  className="btn primary sm"
                  confirmTitle={`Approve release ${row.releaseNo}?`}
                  confirmDescription={
                    <>
                      This approves the fund release of <strong>{formatMoney(row.amount)}</strong> to{" "}
                      <strong>{row.granteeName}</strong> and cannot be undone. A reason is recorded in
                      the audit trail.
                    </>
                  }
                  confirmLabel="Approve release"
                  requireReason
                  reasonLabel="Approval reference / reason (required)"
                  onConfirm={async (reason) => {
                    await postAction(`/api/proxy/v1/grants/releases/${row.id}/approve`, { reason });
                    router.refresh();
                  }}
                />
              ) : (
                <span aria-hidden="true">—</span>
              ),
          },
        ]
      : []),
  ];

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<GrantRelease>
        columns={columns}
        rows={rows}
        rowLinkPrefix="/grants/disbursements/"
        rowLinkKey="id"
        sortable
        filterable
        filterPlaceholder="Filter releases…"
        pageSize={15}
      />
    </>
  );
}
