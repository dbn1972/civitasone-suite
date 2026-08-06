"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, ActionButton } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

/**
 * The releases list API returns `amount` in RUPEES (minorToAmount on the
 * backend). formatMoney() expects paise, which rendered every amount 100×
 * too small here — format the rupee number directly.
 */
function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
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
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GrantRelease[]>(
    "grants.releases",
    releases,
    source,
    (d) => d.length === 0,
  );

  const columns: Col[] = [
    { key: "releaseNo", label: "Release No" },
    { key: "grantNo", label: "Grant No" },
    { key: "granteeName", label: "Grantee" },
    { key: "amount", label: "Amount", align: "right", render: (row) => formatRupees(row.amount) },
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
            label="Submit for approval"
            className="btn primary sm"
            confirmTitle={`Submit release ${row.releaseNo} for approval?`}
            confirmDescription={
              <>
                This raises an eOffice approval file for the fund release of{" "}
                <strong>{formatRupees(row.amount)}</strong> to <strong>{row.granteeName}</strong>.
                The disbursement moves forward only when the file is decided. A reason is recorded
                in the audit trail.
              </>
            }
            confirmLabel="Submit for approval"
            requireReason
            reasonLabel="Approval reference / reason (required)"
            onConfirm={async (reason) => {
              // Row ids ARE disbursement ids; the decision itself comes back on
              // grant.disbursement.file_decided via the eOffice integration.
              await postAction(`/api/proxy/v1/grants/disbursements/${row.id}/submit-approval`, {
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
      <DataTable<GrantRelease> columns={columns} rows={rows} sortable filterable filterPlaceholder="Filter releases…" pageSize={15} />
    </>
  );
}
