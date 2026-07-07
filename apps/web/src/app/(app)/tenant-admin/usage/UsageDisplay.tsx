"use client";

import { EmptyState } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type EnrichedResource = {
  resource: string;
  label: string;
  icon: string;
  limit: number;
  used: number;
  unit: string;
  projectedOverageDate: string | null;
  percent: number;
};

function getColor(percent: number): string {
  if (percent >= 90) return "#ef4444";
  if (percent >= 70) return "#f59e0b";
  return "#10b981";
}

function getBarBg(percent: number): string {
  if (percent >= 90) return "#fef2f2";
  if (percent >= 70) return "#fffbeb";
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
  const { data } = useSeededResource("admin.usage", resources, source, (d) => d.length === 0);

  if (data.length === 0) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <EmptyState icon="📊" title="No usage data" message="Usage metrics will appear here once your tenant has active resources." />
      </div>
    );
  }

  return (
    <>
      {anyWarning && (
        <div role="alert" style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <p style={{ margin: 0, fontSize: 14, color: "#991b1b", fontWeight: 600 }}>🚨 Usage Warning</p>
          {data.filter((r) => r.percent >= 90).map((r) => (
            <p key={r.resource} style={{ margin: "4px 0 0", fontSize: 13, color: "#dc2626" }}>
              You&apos;ve used {r.percent}% of your {r.label} quota. Upgrade or contact admin.
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
                <span style={{ fontSize: 13, color: "#6b7280" }}>
                  {r.used.toLocaleString()} / {r.limit.toLocaleString()} {r.unit}
                  {r.percent >= 80 && (
                    <a href="/tenant-admin/plans" className="btn btn-sm" style={{ marginLeft: 8, fontSize: 11, padding: "2px 8px" }}>
                      Upgrade
                    </a>
                  )}
                </span>
              </div>
              <div style={{ width: "100%", height: 24, borderRadius: 12, background: getBarBg(r.percent), overflow: "hidden" }}>
                <div
                  role="progressbar"
                  aria-valuenow={r.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${r.label} usage: ${r.percent}%`}
                  style={{
                    width: `${Math.min(r.percent, 100)}%`,
                    height: "100%",
                    borderRadius: 12,
                    background: getColor(r.percent),
                    transition: "width 0.5s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {r.percent}%
                </div>
              </div>
              {r.projectedOverageDate && (
                <p style={{ fontSize: 12, color: getColor(r.percent), marginTop: 4 }}>
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
