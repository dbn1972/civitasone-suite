import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { getPlansData } from "@/app/_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { PlansClient } from "./PlansClient";

export default async function PlansPage() {
  const { data: plansData, source } = await getPlansData();
  const currentPlan = plansData.plans.find((p) => p.id === plansData.currentPlanId);

  return (
    <div className="page-main wrap">
      <PageHeader title="Plans & Subscription" subtitle="Compare plans, upgrade, or manage your subscription." back="/tenant-admin" />

      <StatGrid>
        <StatCard icon="📋" iconBg="#eef2ff" label="Current Plan" value={currentPlan?.name ?? "—"} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Max Users" value={currentPlan?.maxUsers?.toLocaleString("en-IN") ?? "—"} />
        <StatCard icon="💾" iconBg="#dbeafe" label="Storage" value={currentPlan ? `${currentPlan.storageGb} GB` : "—"} />
        {/* GAP-TENANT-ADMIN-PLANS-06: one shared paise formatter (formatMoney),
            no duplicated paise/100 float division. */}
        <StatCard icon="💰" iconBg="#fef3c7" label="Monthly Cost" value={currentPlan ? formatMoney(currentPlan.pricePerMonth) : "—"} />
      </StatGrid>

      <PlansClient plansData={plansData} source={source} />
    </div>
  );
}
