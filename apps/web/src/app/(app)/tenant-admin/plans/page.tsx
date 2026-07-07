import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getPlansData } from "@/app/_data/loaders";
import { PlansClient } from "./PlansClient";

function formatCurrency(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export default async function PlansPage() {
  const { data: plansData, source } = await getPlansData();
  const currentPlan = plansData.plans.find((p) => p.id === plansData.currentPlanId);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Plans & Subscription" subtitle="Compare plans, upgrade, or manage your subscription." back="/tenant-admin" />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📋" iconBg="#eef2ff" label="Current Plan" value={currentPlan?.name ?? "—"} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Max Users" value={currentPlan?.maxUsers?.toLocaleString() ?? "—"} />
        <StatCard icon="💾" iconBg="#dbeafe" label="Storage" value={currentPlan ? `${currentPlan.storageGb} GB` : "—"} />
        <StatCard icon="💰" iconBg="#fef3c7" label="Monthly Cost" value={currentPlan ? formatCurrency(currentPlan.pricePerMonth) : "—"} />
      </StatGrid>

      <PlansClient plansData={plansData} source={source} />
    </main>
  );
}
