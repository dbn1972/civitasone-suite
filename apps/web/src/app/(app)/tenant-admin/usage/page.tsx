"use client";

import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";

interface UsageResource {
  resource: string;
  label: string;
  icon: string;
  limit: number;
  used: number;
  unit: string;
  projectedOverageDate: string | null;
}

const USAGE_DATA: UsageResource[] = [
  { resource: "users", label: "Users", icon: "👥", limit: 500, used: 423, unit: "users", projectedOverageDate: "2024-08-15" },
  { resource: "storage_gb", label: "Storage", icon: "💾", limit: 100, used: 67, unit: "GB", projectedOverageDate: null },
  { resource: "api_calls_daily", label: "API Calls (Daily)", icon: "🔌", limit: 50000, used: 46200, unit: "calls", projectedOverageDate: "2024-07-15" },
  { resource: "documents", label: "Documents", icon: "📄", limit: 10000, used: 7800, unit: "docs", projectedOverageDate: "2024-09-01" },
];

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

export default function UsagePage() {
  const resources = USAGE_DATA.map((r) => ({
    ...r,
    percent: Math.round((r.used / r.limit) * 100),
  }));

  const anyWarning = resources.some((r) => r.percent >= 90);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Usage & Quotas" subtitle="Monitor your resource consumption and plan upgrades." back="/tenant-admin" />

      {anyWarning && (
        <UsageWarningBanner resources={resources.filter((r) => r.percent >= 90)} />
      )}

      <StatGrid>
        <StatCard icon="📊" iconBg="#eef2ff" label="Total Resources" value={resources.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Under 70%" value={resources.filter((r) => r.percent < 70).length} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Warning (70-90%)" value={resources.filter((r) => r.percent >= 70 && r.percent < 90).length} />
        <StatCard icon="🚨" iconBg="#fce7ee" label="Critical (>90%)" value={resources.filter((r) => r.percent >= 90).length} />
      </StatGrid>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-h"><h3>Resource Usage</h3></div>
        <div style={{ padding: 16 }}>
          {resources.map((r) => (
            <div key={r.resource} style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {r.icon} {r.label}
                </span>
                <span style={{ fontSize: 13, color: "#6b7280" }}>
                  {r.used.toLocaleString()} / {r.limit.toLocaleString()} {r.unit}
                  {r.percent >= 80 && (
                    <button className="btn btn-sm" style={{ marginLeft: 8, fontSize: 11, padding: "2px 8px" }}>
                      Upgrade
                    </button>
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
    </main>
  );
}

function UsageWarningBanner({ resources }: { resources: Array<{ label: string; percent: number }> }) {
  return (
    <div role="alert" style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <p style={{ margin: 0, fontSize: 14, color: "#991b1b", fontWeight: 600 }}>
        🚨 Usage Warning
      </p>
      {resources.map((r) => (
        <p key={r.label} style={{ margin: "4px 0 0", fontSize: 13, color: "#dc2626" }}>
          You&apos;ve used {r.percent}% of your {r.label} quota. Upgrade or contact admin.
        </p>
      ))}
    </div>
  );
}
