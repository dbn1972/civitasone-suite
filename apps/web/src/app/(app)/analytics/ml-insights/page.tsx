import Link from "next/link";
import { PageHeader, StatGrid, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getMLDomainOverview } from "./_data";

const DOMAIN_META: Record<string, { label: string; icon: string; iconBg: string; href: string }> = {
  leads: { label: "Lead Scoring", icon: "🎯", iconBg: "var(--infobg)", href: "/analytics/ml-insights/leads" },
  tickets: { label: "SLA Breach Prediction", icon: "🎫", iconBg: "var(--warnbg)", href: "/analytics/ml-insights/tickets" },
  inventory: { label: "Demand Forecasting", icon: "📦", iconBg: "var(--goodbg)", href: "/analytics/ml-insights/inventory" },
  subscriptions: { label: "Churn Prediction", icon: "💳", iconBg: "var(--badbg)", href: "/analytics/ml-insights/subscriptions" },
  // Noun kept consistent with the task-level page (GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-07).
  tasks: { label: "Task Delay Prediction", icon: "📋", iconBg: "var(--infobg)", href: "/analytics/ml-insights/projects" },
  transactions: { label: "Anomaly Detection", icon: "🔍", iconBg: "var(--warnbg)", href: "/analytics/ml-insights/anomalies" },
};

function formatPct(value: number | null): string {
  return value == null || Number.isNaN(value) ? "—" : `${Math.round(value * 100)}%`;
}

export default async function MLInsightsHubPage() {
  const { data: domains, source } = await getMLDomainOverview();

  // A failed fetch must not silently read as "ML is off" (0/6, zeros). Show
  // an honest, retryable error state. GAP-ANALYTICS-ML-INSIGHTS-01 (FAILMASK).
  if (source === "error") {
    return (
      <div className="page-main wrap">
        <PageHeader
          title="ML Insights"
          subtitle="Prediction volume, average confidence and fallback rate across all ML-powered domains."
          back="/analytics"
        />
        <RefreshErrorState error={toHumanError("load", { area: "ML domain summary" })} backHref="/analytics" />
      </div>
    );
  }

  const totalPredictions = domains.reduce((sum, d) => sum + d.totalPredictions, 0);
  // A domain "has predictions" when ml-service reported at least one in the window.
  const domainsWithPredictions = domains.filter((d) => d.totalPredictions > 0).length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="ML Insights"
        subtitle="Prediction volume, average confidence and fallback rate across all ML-powered domains."
        back="/analytics"
      />
      <StatGrid>
        <StatCard icon="🤖" tone="info" label="Total Predictions (30d)" value={totalPredictions.toLocaleString("en-IN")} />
        {/* No cross-domain "Avg. Accuracy": ml-service reports only mean prediction
            confidence per domain, which is not accuracy. GAP-ANALYTICS-ML-INSIGHTS-02. */}
        <StatCard icon="📈" tone="good" label="Domains with predictions" value={`${domainsWithPredictions}/${Object.keys(DOMAIN_META).length}`} />
      </StatGrid>
      {domains.length === 0 && (
        <p style={{ color: "var(--mut)", marginTop: 12 }}>No ML predictions have been recorded in the last 30 days.</p>
      )}
      <section
        aria-label="ML domain cards"
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", marginTop: 24 }}
      >
        {Object.entries(DOMAIN_META).map(([key, meta]) => {
          const domainData = domains.find((d) => d.domain === key);
          const ariaLabel = domainData
            ? `${meta.label} — average confidence ${formatPct(domainData.avgConfidence)}, ${domainData.totalPredictions.toLocaleString("en-IN")} predictions`
            : `${meta.label} — no predictions yet`;
          return (
            <Link
              key={key}
              href={meta.href}
              className="stat"
              style={{ display: "block", color: "inherit", textDecoration: "none" }}
              aria-label={ariaLabel}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <span style={{ background: meta.iconBg, borderRadius: 8, padding: "4px 8px", fontSize: 22 }} aria-hidden>
                  {meta.icon}
                </span>
                <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{meta.label}</h2>
              </div>
              {domainData ? (
                <dl
                  style={{ display: "grid", gridTemplateColumns: "1fr auto", columnGap: 16, rowGap: 4, fontSize: 14, color: "var(--ink2)", margin: 0 }}
                >
                  <dt>Avg. confidence</dt>
                  <dd style={{ textAlign: "end", fontWeight: 500, margin: 0 }}>{formatPct(domainData.avgConfidence)}</dd>
                  <dt>Predictions</dt>
                  <dd style={{ textAlign: "end", fontWeight: 500, margin: 0 }}>{domainData.totalPredictions.toLocaleString("en-IN")}</dd>
                  <dt>Fallback Rate</dt>
                  <dd style={{ textAlign: "end", fontWeight: 500, margin: 0 }}>{formatPct(domainData.fallbackRate)}</dd>
                </dl>
              ) : (
                <p style={{ color: "var(--mut)", fontSize: 14, margin: 0 }}>No predictions yet</p>
              )}
            </Link>
          );
        })}
      </section>
    </div>
  );
}
