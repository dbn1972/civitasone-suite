import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getMLDomainOverview } from "./_data";

const DOMAIN_META: Record<string, { label: string; icon: string; iconBg: string; href: string }> = {
  leads: { label: "Lead Scoring", icon: "🎯", iconBg: "#eef2ff", href: "/analytics/ml-insights/leads" },
  tickets: { label: "SLA Breach Prediction", icon: "🎫", iconBg: "#fef9c3", href: "/analytics/ml-insights/tickets" },
  inventory: { label: "Demand Forecasting", icon: "📦", iconBg: "#dcfce7", href: "/analytics/ml-insights/inventory" },
  subscriptions: { label: "Churn Prediction", icon: "💳", iconBg: "#fce7f3", href: "/analytics/ml-insights/subscriptions" },
  tasks: { label: "Project Delay Prediction", icon: "📋", iconBg: "#dbeafe", href: "/analytics/ml-insights/projects" },
  transactions: { label: "Anomaly Detection", icon: "🔍", iconBg: "#fef3c7", href: "/analytics/ml-insights/anomalies" },
};

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default async function MLInsightsHubPage() {
  const { data: domains, source } = await getMLDomainOverview();

  const totalPredictions = domains.reduce((sum, d) => sum + d.totalPredictions, 0);
  const avgAccuracy = domains.length > 0
    ? domains.reduce((sum, d) => sum + d.accuracy, 0) / domains.length
    : 0;
  const avgFallback = domains.length > 0
    ? domains.reduce((sum, d) => sum + d.fallbackRate, 0) / domains.length
    : 0;
  const activeDomains = domains.filter((d) => d.modelVersion !== null).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="ML Insights"
        subtitle="Model performance, prediction accuracy, and explainability metrics across all ML-powered domains."
        back="/analytics"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🤖" iconBg="#eef2ff" label="Total Predictions (30d)" value={totalPredictions.toLocaleString("en-IN")} />
        <StatCard icon="🎯" iconBg="#dcfce7" label="Avg. Accuracy" value={avgAccuracy > 0 ? formatPct(avgAccuracy) : "—"} />
        <StatCard icon="⚠️" iconBg="#fef9c3" label="Avg. Fallback Rate" value={avgFallback > 0 ? formatPct(avgFallback) : "—"} />
        <StatCard icon="✅" iconBg="#dbeafe" label="Active Domains" value={`${activeDomains}/${Object.keys(DOMAIN_META).length}`} />
      </StatGrid>
      <section aria-label="ML domain cards" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        {Object.entries(DOMAIN_META).map(([key, meta]) => {
          const domainData = domains.find((d) => d.domain === key);
          return (
            <a
              key={key}
              href={meta.href}
              className="block p-4 border rounded-lg hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
              aria-label={`${meta.label} — ${domainData ? formatPct(domainData.accuracy) + " accuracy" : "No model"}`}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl" style={{ background: meta.iconBg, borderRadius: 8, padding: "4px 8px" }} aria-hidden>
                  {meta.icon}
                </span>
                <h3 className="text-base font-semibold">{meta.label}</h3>
              </div>
              {domainData ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600">
                  <dt>Accuracy</dt>
                  <dd className="text-right font-medium">{formatPct(domainData.accuracy)}</dd>
                  <dt>Predictions</dt>
                  <dd className="text-right font-medium">{domainData.totalPredictions.toLocaleString("en-IN")}</dd>
                  <dt>Fallback Rate</dt>
                  <dd className="text-right font-medium">{formatPct(domainData.fallbackRate)}</dd>
                  <dt>Top Factor</dt>
                  <dd className="text-right font-medium truncate">{domainData.topFactor}</dd>
                </dl>
              ) : (
                <p className="text-sm text-gray-400">No model active</p>
              )}
            </a>
          );
        })}
      </section>
    </main>
  );
}
