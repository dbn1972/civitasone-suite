"use client";

import { StatusPill, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Asset = {
  id: string;
  assetCode: string;
  name: string;
  location?: string | null;
  currentValue: number;
  status: string;
} & Record<string, unknown>;

export function AssetsTable({ assets, source = "api" }: { assets: Asset[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Asset[]>(
    "assets.register",
    assets,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h">
        <h3>Fixed asset register</h3>
        <div className="seg">
          <span className="on">All</span>
          <span>Untagged</span>
          <span>AMC due</span>
        </div>
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon="🖥️" title="No assets found" message="Register assets to build your fixed asset register." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Item</th>
              <th>Location</th>
              <th className="num">Net value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((asset) => (
              <tr key={asset.id} className="clickable">
                <td>
                  <a href={`/assets/${asset.id}`}>
                    <span className="mono">{asset.assetCode}</span>
                  </a>
                </td>
                <td>{asset.name}</td>
                <td>{asset.location ?? "—"}</td>
                <td className="num">₹{(asset.currentValue / 100).toLocaleString("en-IN")}</td>
                <td>
                  <StatusPill status={asset.status.replace(/_/g, " ")} label={asset.status.replace(/_/g, " ")} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
