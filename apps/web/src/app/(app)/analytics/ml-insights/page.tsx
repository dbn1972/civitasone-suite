import Link from "next/link";
import { PageHeader, StatGrid, StatCard, StatusPill, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { getMLDomainOverview, type MLDomainSummary } from "./_data";
import { metricForDomain } from "./_metrics";

const DOMAIN_META: Record<string, { label: string; icon: string; iconBg: string; href: string }> = {
  leads: { label: "Lead Scoring", icon: "🎯", iconBg: "#eef2ff", href: "/analytics/ml-insights/leads" },
  tickets: { label: "SLA Breach Prediction", icon: "🎫", iconBg: "#fef9c3", href: "/analytics/ml-insights/tickets" },
  inventory: { label: "Demand Forecasting", icon: "📦", iconBg: "#dcfce7", href: "/analytics/ml-insights/inventory" },
  subscriptions: { label: "Churn Prediction", icon: "💳", iconBg: "#fce7f3", href: "/analytics/ml-insights/subscriptions" },
  // Noun kept consistent with the task-level page (GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-07).
  tasks: { label: "Task Delay Prediction", icon: "📋", iconBg: "#dbeafe", href: "/analytics/ml-insights/projects" },
  transactions: { label: "Anomaly Detection", icon: "🔍", iconBg: "#fef3c7", href: "/analytics/ml-insights/anomalies" },
};

/** A model not retrained within this many days is treated as stale. */
const STALE_AFTER_DAYS = 90;

function formatPct(value: number | null): string {
  return value == null || Number.isNaN(value) ? "—" : `${Math.round(value * 100)}%`;
}

function isStale(lastTrainedAt: string | null): boolean {
  if (!lastTrainedAt) return false;
  const t = new Date(lastTrainedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** A domain is "active" only if it has a model AND that model is not stale. */
function isActive(d: MLDomainSummary): boolean {
  return d.modelVersion !== null && !isStale(d.lastTrainedAt);
}

export default async function MLInsightsHubPage() {
  const { data: domains, source } = await getMLDomainOverview();

  // A failed fetch must not silently read as "ML is off" (0/6, zeros). Show
  // an honest, retryable error state. GAP-ANALYTICS-ML-INSIGHTS-01 (FAILMASK).
  if (source === "error") {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader
          title="ML Insights"
          subtitle="Model performance, prediction accuracy, and explainability metrics across all ML-powered domains."
          back="/analytics"
        />
        <RefreshErrorState error={toHumanError("load", { area: "ML domain summary" })} backHref="/analytics" />
      </div>
    );
  }

  const totalPredictions = domains.reduce((sum, d) => sum + d.totalPredictions, 0);
  const activeDomains = domains.filter(isActive).length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="ML Insights"
        subtitle="Model performance, prediction accuracy, and explainability metrics across all ML-powered domains."
        back="/analytics"
      />
      <StatGrid>
        <StatCard icon="🤖" iconBg="#eef2ff" label="Total Predictions (30d)" value={totalPredictions.toLocaleString("en-IN")} />
        {/* No cross-metric "Avg. Accuracy": the domains report different, non-
            comparable metrics (AUC-ROC / Precision / MAPE↓), so averaging them
            is arithmetically meaningless. GAP-ANALYTICS-ML-INSIGHTS-02. */}
        <StatCard icon="📈" iconBg="#dcfce7" label="Domains with model" value={`${domains.filter((d) => d.modelVersion !== null).length}/${Object.keys(DOMAIN_META).length}`} />
        <StatCard icon="✅" iconBg="#dbeafe" label="Active (not stale)" value={`${activeDomains}/${Object.keys(DOMAIN_META).length}`} />
      </StatGrid>
      {domains.length === 0 && (
        <p style={{ color: "var(--mut)", marginTop: 12 }}>No ML models are active yet.</p>
      )}
      <section aria-label="ML domain cards" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        {Object.entries(DOMAIN_META).map(([key, meta]) => {
          const domainData = domains.find((d) => d.domain === key);
          const metric = metricForDomain(key);
          const metricDirection = metric.higherIsBetter ? "higher is better" : "lower is better";
          const stale = domainData ? isStale(domainData.lastTrainedAt) : false;
          const ariaLabel = domainData
            ? `${meta.label} — ${metric.label} ${formatPct(domainData.accuracy)} (${metricDirection})${stale ? ", model stale" : ""}`
            : `${meta.label} — no model active`;
          return (
            <Link
              key={key}
              href={meta.href}
              className="stat"
              style={{ display: "block", color: "inherit", textDecoration: "none" }}
              aria-label={ariaLabel}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl" style={{ background: meta.iconBg, borderRadius: 8, padding: "4px 8px" }} aria-hidden>
                  {meta.icon}
                </span>
                <h3 className="text-base font-semibold">{meta.label}</h3>
                {stale && <StatusPill status="stale" label="Stale" />}
              </div>
              {domainData ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600">
                  <dt>{metric.label}{metric.higherIsBetter ? "" : " ↓"}</dt>
                  <dd className="text-end font-medium">{formatPct(domainData.accuracy)}</dd>
                  <dt>Predictions</dt>
                  <dd className="text-end font-medium">{domainData.totalPredictions.toLocaleString("en-IN")}</dd>
                  <dt>Fallback Rate</dt>
                  <dd className="text-end font-medium">{formatPct(domainData.fallbackRate)}</dd>
                  <dt>Last trained</dt>
                  <dd className="text-end font-medium">{domainData.lastTrainedAt ? formatIndianDate(domainData.lastTrainedAt) : "—"}</dd>
                </dl>
              ) : (
                <p className="text-sm" style={{ color: "var(--mut)" }}>No model active</p>
              )}
            </Link>
          );
        })}
      </section>
    </div>
  );
}
