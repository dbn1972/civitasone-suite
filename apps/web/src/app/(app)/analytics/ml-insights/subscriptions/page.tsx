import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";

export default async function SubscriptionsInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("subscriptions");

  return (
    <DomainInsightPage
      title="Churn Prediction Insights"
      subtitle="Model performance for subscription churn probability predictions."
      domain="subscriptions"
      evaluation={evaluation}
      source={source}
      rowLinkPrefix="/billing/subscriptions/"
      statLabels={{
        predictions: "Subscriptions Scored",
        accuracy: "AUC-ROC",
        fallbackRate: "Fallback Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
