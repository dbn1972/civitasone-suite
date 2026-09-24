import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { getPlansData } from "@/app/_data/loaders";
import { PlansClient } from "./PlansClient";

function formatCurrency(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export default async function PlansPage() {
  const { data: plansData, source } = await getPlansData();
  const currentPlan = plansData.plans.find((p) => p.id === plansData.currentPlanId);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside PlansClient, driven by
          the same useSeededResource call that produces its data — not a
          second, independent read of `source` here that could disagree
          with the client's own cache state (UX-002's pattern). */}
      <PageHeader title="Plans & Subscription" subtitle="Compare plans, upgrade, or manage your subscription." back="/tenant-admin" />

      <StatGrid>
        <StatCard icon="📋" iconBg="#eef2ff" label="Current Plan" value={currentPlan?.name ?? "—"} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Max Users" value={currentPlan?.maxUsers?.toLocaleString("en-IN") ?? "—"} />
        <StatCard icon="💾" iconBg="#dbeafe" label="Storage" value={currentPlan ? `${currentPlan.storageGb} GB` : "—"} />
        <StatCard icon="💰" iconBg="#fef3c7" label="Monthly Cost" value={currentPlan ? formatCurrency(currentPlan.pricePerMonth) : "—"} />
      </StatGrid>

      <PlansClient plansData={plansData} source={source} />
    </div>
  );
}
