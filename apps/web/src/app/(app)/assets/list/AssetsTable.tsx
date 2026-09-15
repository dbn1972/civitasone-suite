"use client";

import { useState } from "react";
import { DataTable, Segmented, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

type Asset = {
  id: string;
  assetCode: string;
  name: string;
  location?: string | null;
  currentValue: number;
  status: string;
} & Record<string, unknown>;

type Row = {
  id: string;
  assetCode: string;
  name: string;
  location: string;
  currentValue: number;
  status: string;
};

const TABS = ["All", "Active", "In maintenance"] as const;

export function AssetsTable({ assets, source = "api" }: { assets: Asset[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Asset[]>(
    "assets.register",
    assets,
    source,
    (d) => d.length === 0,
  );
  const [tab, setTab] = useState<string>("All");

  const tableRows: Row[] = rows.map((a) => ({
    id: a.id,
    assetCode: a.assetCode,
    name: a.name,
    location: a.location ?? "—",
    currentValue: a.currentValue,
    status: a.status.replace(/_/g, " "),
  }));

  const filtered =
    tab === "Active"
      ? tableRows.filter((r) => /^(active|in use)$/i.test(r.status))
      : tab === "In maintenance"
        ? tableRows.filter((r) => /maintenance|repair/i.test(r.status))
        : tableRows;

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h">
        <h3>Fixed asset register</h3>
        <Segmented options={[...TABS]} value={tab} onChange={setTab} />
      </div>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {tableRows.length === 0 ? (
        <EmptyState icon="🖥️" title="No assets found" message="Register assets to build your fixed asset register." />
      ) : (
        <DataTable
          columns={[
            { key: "assetCode", label: "Asset" },
            { key: "name", label: "Item" },
            { key: "location", label: "Location" },
            { key: "currentValue", label: "Net value", align: "right", cellType: "amount" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={filtered}
          rowLinkKey="id"
          rowLinkPrefix="/assets/"
          identifyingColumnKey="name"
          sortable
          filterable
          filterPlaceholder="Filter assets…"
          pageSize={15}
        />
      )}
    </div>
  );
}
