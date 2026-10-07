import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { ML_EXPORT_ROLES } from "../_access";

export default async function SubscriptionsInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("subscriptions");
  const canExport = hasAnyRole(getSessionRoles(), ML_EXPORT_ROLES);

  return (
    <DomainInsightPage
      title="Churn Prediction Insights"
      subtitle="Model performance for subscription churn probability predictions."
      domain="subscriptions"
      evaluation={evaluation}
      source={source}
      // Drill-through unset: billing/subscriptions has no [id] detail route,
      // so the previous "/billing/subscriptions/" prefix 404'd on every row.
      // Restore once a reviewed subscription detail page exists.
      // GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-02.
      canExport={canExport}
      statLabels={{
        predictions: "Subscriptions Scored",
        accuracy: "AUC-ROC",
        fallbackRate: "Fallback Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
