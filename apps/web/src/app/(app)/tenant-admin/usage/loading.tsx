import { StatGrid, StatCard } from "@/app/_components/ds";

/**
 * GAP-TENANT-ADMIN-USAGE-05: page-specific loading skeleton mirroring the
 * stat-grid + resource card the real page renders, so the layout doesn't jump
 * on hydrate. The parent tenant-admin/loading.tsx is a generic fallback.
 */
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading usage & quotas">
      <StatGrid>
        <StatCard icon="📊" iconBg="#eef2ff" label="Total Resources" value="…" />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Under 70%" value="…" />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Warning (70-90%)" value="…" />
        <StatCard icon="🚨" iconBg="#fce7ee" label="Critical (90%+)" value="…" />
      </StatGrid>
      <div className="card" style={{ marginTop: 24 }}>
        <div className="skeleton" style={{ height: 200 }} aria-hidden="true" />
      </div>
    </div>
  );
}
