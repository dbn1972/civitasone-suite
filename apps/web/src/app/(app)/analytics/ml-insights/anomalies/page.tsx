import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";

export default async function AnomaliesInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("transactions");

  return (
    <DomainInsightPage
      title="Anomaly Detection Insights"
      subtitle="Z-score anomaly detection precision and false positive rate for financial transaction monitoring."
      domain="transactions"
      evaluation={evaluation}
      source={source}
      rowLinkPrefix="/finance/anomalies/"
      statLabels={{
        predictions: "Transactions Scored",
        accuracy: "Precision",
        fallbackRate: "False Positive Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
