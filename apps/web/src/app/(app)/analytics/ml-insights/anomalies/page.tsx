import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { ML_EXPORT_ROLES } from "../_access";

export default async function AnomaliesInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("transactions");
  const canExport = hasAnyRole(getSessionRoles(), ML_EXPORT_ROLES);

  return (
    <DomainInsightPage
      title="Anomaly Detection Insights"
      subtitle="Z-score anomaly detection precision and fallback rate for financial transaction monitoring."
      domain="transactions"
      evaluation={evaluation}
      source={source}
      // No drill-through target exists yet: apps/web/src/app/(app)/finance has
      // no `anomalies` route, so the previous rowLinkPrefix="/finance/anomalies/"
      // 404'd on every row. Left unset until a reviewed target (payment vs
      // journal entry) is confirmed with finance. GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-02.
      canExport={canExport}
      statLabels={{
        predictions: "Transactions Scored",
        accuracy: "Precision",
        // Backend `fallbackRate` is the rule-based fallback share, NOT a false
        // positive rate — relabelled honestly. GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-06.
        fallbackRate: "Fallback Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
