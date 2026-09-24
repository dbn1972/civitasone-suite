import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { getUsageQuotas } from "@/app/_data/loaders";
import { UsageDisplay } from "./UsageDisplay";

export default async function UsagePage() {
  const { data: resources, source } = await getUsageQuotas();
  const enriched = resources.map((r) => ({
    ...r,
    percent: r.limit > 0 ? Math.round((r.used / r.limit) * 100) : 0,
  }));

  const anyWarning = enriched.some((r) => r.percent >= 90);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside UsageDisplay, driven
          by the same useSeededResource call that produces its data — not a
          second, independent read of `source` here that could disagree
          with the component's own cache state (UX-002's pattern). */}
      <PageHeader title="Usage & Quotas" subtitle="Monitor your resource consumption and plan upgrades." back="/tenant-admin" />

      <StatGrid>
        <StatCard icon="📊" iconBg="#eef2ff" label="Total Resources" value={enriched.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Under 70%" value={enriched.filter((r) => r.percent < 70).length} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Warning (70-90%)" value={enriched.filter((r) => r.percent >= 70 && r.percent < 90).length} />
        <StatCard icon="🚨" iconBg="#fce7ee" label="Critical (>90%)" value={enriched.filter((r) => r.percent >= 90).length} />
      </StatGrid>

      <UsageDisplay resources={enriched} anyWarning={anyWarning} source={source} />
    </div>
  );
}
