import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { getUsageQuotas } from "@/app/_data/loaders";
import { Breadcrumb } from "../Breadcrumb";
import { UsageDisplay } from "./UsageDisplay";
import { WARN_PCT, CRIT_PCT, usageBand } from "./thresholds";

export default async function UsagePage() {
  const { data: resources, source } = await getUsageQuotas();

  // GAP-TENANT-ADMIN-USAGE-01: a failed fetch resolves to source "error" with
  // an empty array. Previously the four tiles computed from [] read "0" and
  // the card said "No usage data" — an outage looked identical to an unused
  // tenant. Detect the error-with-no-data case up front so the tiles render a
  // dash and UsageDisplay can show a retry-able error state instead.
  const errored = source === "error" && resources.length === 0;

  const enriched = resources.map((r) => ({
    ...r,
    // GAP-TENANT-ADMIN-USAGE-03: a limit of 0 means "no limit" (unlimited /
    // unset). We can't compute a percentage against it, so percent is null and
    // the resource is excluded from the bands/tiles and shown as "Unlimited".
    percent: r.limit > 0 ? Math.round((r.used / r.limit) * 100) : null,
  }));

  // Only resources with a real limit participate in the band counts.
  const bounded = enriched.filter((r): r is typeof r & { percent: number } => r.percent !== null);
  const anyWarning = bounded.some((r) => usageBand(r.percent) === "critical");

  // GAP-TENANT-ADMIN-USAGE-01: tiles show a dash on error, never a misleading 0.
  const tileValue = (n: number): string | number => (errored ? "—" : n);

  return (
    <div className="page-main wrap">
      {/* GAP-TENANT-ADMIN-USAGE-05: sibling tenant-admin pages carry a
          Breadcrumb; this one had none. */}
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Usage & Quotas" }]} />
      {/* UX-012: the data-source badge now lives inside UsageDisplay, driven
          by the same useSeededResource call that produces its data — not a
          second, independent read of `source` here that could disagree
          with the component's own cache state (UX-002's pattern). */}
      <PageHeader title="Usage & Quotas" subtitle="Monitor your resource consumption and plan upgrades." back="/tenant-admin" />

      <StatGrid>
        <StatCard icon="📊" iconBg="#eef2ff" label="Total Resources" value={tileValue(bounded.length)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={`Under ${WARN_PCT}%`} value={tileValue(bounded.filter((r) => usageBand(r.percent) === "ok").length)} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label={`Warning (${WARN_PCT}-${CRIT_PCT}%)`} value={tileValue(bounded.filter((r) => usageBand(r.percent) === "warning").length)} />
        <StatCard icon="🚨" iconBg="#fce7ee" label={`Critical (${CRIT_PCT}%+)`} value={tileValue(bounded.filter((r) => usageBand(r.percent) === "critical").length)} />
      </StatGrid>

      <UsageDisplay resources={enriched} anyWarning={anyWarning} source={source} />
    </div>
  );
}
