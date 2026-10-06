"use client";

import { EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";
import { PLANS_HREF, usageBand, showUpgrade } from "./thresholds";

type EnrichedResource = {
  resource: string;
  label: string;
  icon: string;
  limit: number;
  used: number;
  unit: string;
  projectedOverageDate: string | null;
  /** null when the resource has no limit (unlimited/unset) — GAP-USAGE-03. */
  percent: number | null;
};

function getColor(percent: number): string {
  const band = usageBand(percent);
  if (band === "critical") return "#ef4444";
  if (band === "warning") return "#f59e0b";
  return "#10b981";
}

function getBarBg(percent: number): string {
  const band = usageBand(percent);
  if (band === "critical") return "#fef2f2";
  if (band === "warning") return "#fffbeb";
  return "#ecfdf5";
}

export function UsageDisplay({
  resources,
  anyWarning,
  source,
}: {
  resources: EnrichedResource[];
  anyWarning: boolean;
  source: "api" | "error";
}) {
  const { data, provenance, offline, cachedAt } = useSeededResource("admin.usage", resources, source, (d) => d.length === 0);

  // GAP-TENANT-ADMIN-USAGE-01: an actual fetch failure with nothing cached
  // ("error-no-data") must render a retry-able error state, NOT the "No usage
  // data" empty state (which would make an outage look like an unused tenant).
  if (data.length === 0 && (provenance ?? "live") === "error-no-data") {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
        <RefreshErrorState error={toHumanError("load", { area: "usage" })} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        {/* UX-012: single source of provenance (see UsersTable pattern). */}
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
        <EmptyState icon="📊" title="No usage data" message="Usage metrics will appear here once your tenant has active resources." />
      </div>
    );
  }

  return (
    <>
      {/* UX-012: single source of provenance (see UsersTable pattern). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {anyWarning && (
        <div role="alert" style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <p style={{ margin: 0, fontSize: 14, color: "#991b1b", fontWeight: 600 }}>🚨 Usage Warning</p>
          {data.filter((r) => r.percent !== null && usageBand(r.percent) === "critical").map((r) => (
            <p key={r.resource} style={{ margin: "4px 0 0", fontSize: 13, color: "#dc2626" }}>
              {/* GAP-TENANT-ADMIN-USAGE-04: the banner now carries a working
                  Upgrade link (was plain, unactionable text that also told the
                  tenant admin to "contact admin" — they ARE the admin). */}
              You&apos;ve used {r.percent}% of your {r.label} quota.{" "}
              <a href={PLANS_HREF} style={{ color: "#991b1b", fontWeight: 700, textDecoration: "underline" }}>
                Upgrade your plan
              </a>
              .
            </p>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-h"><h3>Resource Usage</h3></div>
        <div style={{ padding: 16 }}>
          {data.map((r) => (
            <div key={r.resource} style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {r.icon} {r.label}
                </span>
                <span style={{ fontSize: 13, color: "#6b7280", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {r.percent === null ? (
                    /* GAP-TENANT-ADMIN-USAGE-03: no limit set — show the usage
                       count against "Unlimited" rather than a bogus "n / 0". */
                    <span>{r.used.toLocaleString("en-IN")} / Unlimited {r.unit}</span>
                  ) : (
                    <>
                      <span>
                        {r.used.toLocaleString("en-IN")} / {r.limit.toLocaleString("en-IN")} {r.unit}
                      </span>
                      {/* GAP-TENANT-ADMIN-USAGE-05: percent label moved OUT of
                          the coloured bar (was white 11px text, ~2:1 contrast,
                          clipped near 0%) to dark ink beside the counts. */}
                      <span style={{ fontWeight: 700, color: "#111827", minWidth: 36, textAlign: "right" }} aria-hidden="true">
                        {r.percent}%
                      </span>
                      {showUpgrade(r.percent) && (
                        <a href={PLANS_HREF} className="btn btn-sm" style={{ fontSize: 11, padding: "2px 8px" }}>
                          Upgrade
                        </a>
                      )}
                    </>
                  )}
                </span>
              </div>
              {/* GAP-TENANT-ADMIN-USAGE-03: no bar for unlimited resources. */}
              {r.percent !== null && (
                <div style={{ width: "100%", height: 16, borderRadius: 8, background: getBarBg(r.percent), overflow: "hidden" }}>
                  <div
                    role="progressbar"
                    aria-valuenow={r.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${r.label} usage: ${r.percent}%`}
                    style={{
                      width: `${Math.min(r.percent, 100)}%`,
                      height: "100%",
                      borderRadius: 8,
                      background: getColor(r.percent),
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>
              )}
              {r.projectedOverageDate && (
                <p style={{ fontSize: 12, color: r.percent !== null ? getColor(r.percent) : "#6b7280", marginTop: 4 }}>
                  ⏱️ At current rate, you&apos;ll hit the limit on {new Date(r.projectedOverageDate).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
