import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";

export default async function InventoryInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("inventory");

  return (
    <DomainInsightPage
      title="Demand Forecasting Insights"
      subtitle="Exponential smoothing model performance for inventory demand forecast accuracy (MAPE)."
      domain="inventory"
      evaluation={evaluation}
      source={source}
      rowLinkPrefix="/inventory/items/"
      statLabels={{
        predictions: "Forecasts Generated",
        accuracy: "MAPE (lower is better)",
        fallbackRate: "Fallback Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
