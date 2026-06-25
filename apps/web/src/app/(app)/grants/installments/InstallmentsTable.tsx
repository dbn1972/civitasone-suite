"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, ActionButton } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import type { GrantInstallmentSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Col = {
  key: keyof GrantInstallmentSummary & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GrantInstallmentSummary) => ReactNode;
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

export function InstallmentsTable({ installments, source = "api" }: { installments: GrantInstallmentSummary[]; source?: "api" | "error" }) {
  const router = useRouter();
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GrantInstallmentSummary[]>(
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
      <DataTable<GrantInstallmentSummary> columns={columns} rows={rows} sortable filterable filterPlaceholder="Filter installments…" pageSize={15} />
    </>
  );
}
