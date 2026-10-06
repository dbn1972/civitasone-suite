import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { ML_EXPORT_ROLES } from "../_access";

export default async function InventoryInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("inventory");
  const canExport = hasAnyRole(getSessionRoles(), ML_EXPORT_ROLES);

  return (
    <DomainInsightPage
      title="Demand Forecasting Insights"
      subtitle="Exponential smoothing model performance for inventory demand forecast accuracy (MAPE, lower is better)."
      domain="inventory"
      evaluation={evaluation}
      source={source}
      // Demand forecasts score STOCK ITEMS; the stock-item detail lives at
      // /inventory/[id] (getStockItemById). /inventory/items/[id] is the
      // item-MASTER (catalogue) detail, a different record. The stale audit
      // snapshot predated the items/[id] route; the stock-item route is the
      // correct target for entityId. GAP-ANALYTICS-ML-INSIGHTS-INVENTORY-02.
      rowLinkPrefix="/inventory/"
      canExport={canExport}
      statLabels={{
        predictions: "Forecasts Generated",
        accuracy: "MAPE (lower is better)",
        fallbackRate: "Fallback Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
