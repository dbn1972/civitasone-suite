"use client";

import { DataTable } from "@/app/_components/ds";
import type { GrantInstallmentSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

const columns: { key: keyof GrantInstallmentSummary & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
  { key: "grantNo", label: "Grant No" },
  { key: "granteeName", label: "Grantee" },
  { key: "installmentNo", label: "Installment #", align: "right" },
  { key: "amount", label: "Amount (₹)", align: "right", cellType: "amount" },
  { key: "scheduledDate", label: "Scheduled Date" },
  { key: "releasedDate", label: "Released Date" },
  { key: "status", label: "Status", cellType: "status" },
];

export function InstallmentsTable({ installments, source = "api" }: { installments: GrantInstallmentSummary[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GrantInstallmentSummary[]>(
    "grants.installments",
    installments,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<GrantInstallmentSummary> columns={columns} rows={rows} />
    </>
  );
}
