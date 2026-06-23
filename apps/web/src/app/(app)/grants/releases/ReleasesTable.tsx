"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import type { GrantRelease } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Col = {
  key: keyof GrantRelease & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GrantRelease) => ReactNode;
};

const columns: Col[] = [
  { key: "releaseNo", label: "Release No" },
  { key: "grantNo", label: "Grant No" },
  { key: "granteeName", label: "Grantee" },
  { key: "amount", label: "Amount", align: "right", render: (row) => `₹${(row.amount / 100).toLocaleString("en-IN")}` },
  { key: "releaseDate", label: "Release Date" },
  { key: "bankRef", label: "Bank Ref", render: (row) => row.bankRef ?? "—" },
  { key: "status", label: "Status", render: (row) => <StatusPill status={row.status} /> },
];

export function ReleasesTable({ releases, source = "api" }: { releases: GrantRelease[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GrantRelease[]>(
    "grants.releases",
    releases,
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
      <DataTable<GrantRelease> columns={columns} rows={rows} />
    </>
  );
}
