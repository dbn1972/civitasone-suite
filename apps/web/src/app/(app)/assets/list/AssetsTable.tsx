"use client";

import { useState } from "react";
import { DataTable, Segmented, EmptyState, StatCard, StatGrid } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatMoney } from "@/lib/formatters";
import { computeAssetStats, type StatAsset } from "./assetStats";

type Asset = StatAsset & {
  id: string;
  assetCode: string;
  name: string;
  location?: string | null;
  type?: string;
} & Record<string, unknown>;

type Row = {
  id: string;
  assetCode: string;
  name: string;
  type: string;
  location: string;
  currentValue: number;
  status: string;
  /** The typed asset status (not the display text) -- the tabs filter on this. */
  statusKey: string;
};

const TABS = ["All", "Active", "In maintenance"] as const;

type Props = {
  assets: Asset[];
  source?: "api" | "error";
  /** Offline cache key -- one per register so cached rows never cross pages. */
  cacheKey?: string;
  /** Restrict to one asset type (the fixed-asset register passes "fixed"). */
  typeFilter?: string;
  heading?: string;
};

/**
 * One implementation for /assets/list (all types) and /assets/fixed-assets
 * (type "fixed") -- GAP-ASSETS-FIXED-ASSETS-01 / GAP-ASSETS-LIST-01. The stat
 * tiles are computed from the SAME rows the table renders (live or cached),
 * so they can never disagree with it (GAP-ASSETS-LIST-02).
 */
export function AssetsTable({ assets, source = "api", cacheKey = "assets.register", typeFilter, heading = "Asset register" }: Props) {
  const { data, provenance, offline, cachedAt } = useSeededResource<Asset[]>(
    cacheKey,
    assets,
    source,
    (d) => d.length === 0,
  );
  const [tab, setTab] = useState<string>("All");

  const rows = typeFilter ? data.filter((a) => a.type === typeFilter) : data;
  // A failed fetch with nothing cached is unknown, not zero.
  const unknown = provenance === "error-no-data";
  const stats = computeAssetStats(rows);

  const tableRows: Row[] = rows.map((a) => ({
    id: a.id,
    assetCode: a.assetCode,
    name: a.name,
    type: a.type ?? "—",
    location: a.location ?? "—",
    currentValue: a.currentValue,
    status: a.status.replace(/_/g, " "),
    statusKey: a.status,
  }));

  // GAP-ASSETS-LIST-04: compare the typed status, not a regex over the display text.
  const filtered =
    tab === "Active"
      ? tableRows.filter((r) => r.statusKey === "active" || r.statusKey === "in_use")
      : tab === "In maintenance"
        ? tableRows.filter((r) => r.statusKey === "maintenance")
        : tableRows;

  return (
    <>
      <StatGrid>
        <StatCard icon="🖥️" tone="warn" label={typeFilter === "fixed" ? "Fixed Assets" : "Assets"} value={unknown ? null : stats.count.toLocaleString("en-IN")} />
        <StatCard icon="✅" tone="info" label="Active / in use" value={unknown ? null : `${stats.activePct}%`} />
        <StatCard icon="💰" tone="good" label="Gross Block" value={unknown ? null : formatMoney(stats.grossBlock)} />
        <StatCard icon="📉" tone="warn" label="Net Book Value" value={unknown ? null : formatMoney(stats.netBlock)} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>{heading}</h3>
          <Segmented options={[...TABS]} value={tab} onChange={setTab} />
        </div>
        {/* UX-012: the only provenance badge; it reads the same useSeededResource
            call as the rows and the stat tiles above. */}
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
        {tableRows.length === 0 ? (
          <EmptyState icon="🖥️" title="No assets found" message="Register assets to build the asset register." />
        ) : (
          <DataTable
            columns={[
              { key: "assetCode", label: "Asset" },
              { key: "name", label: "Item" },
              ...(typeFilter ? [] : [{ key: "type" as const, label: "Type" }]),
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
    </>
  );
}
