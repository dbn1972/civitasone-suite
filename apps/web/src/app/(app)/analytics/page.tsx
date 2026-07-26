import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Data & Analytics"
      description="Saved dashboards and safe, whitelisted query runs over the analytics service's own data."
      links={[
        { href: "/analytics/dashboards", label: "Dashboards", note: "Saved dashboards with widgets, sharing and access control" },
        { href: "/analytics/queries", label: "Query Results", note: "Recent query runs with accessible charts and tables" },
        { href: "/analytics/list", label: "Dashboards (legacy list)", note: "Simple read-only list view" },
        { href: "/analytics/kpi", label: "KPI Library", note: "Organisation-wide Key Performance Indicators" },
        { href: "/analytics/data-warehouse", label: "Data Warehouse", note: "Consolidated datasets and data quality metrics" },
        { href: "/analytics/ai-insights", label: "AI Insights", note: "ML-powered insights and recommendations" },
        { href: "/analytics/ms-insights", label: "ML Insights", note: "Model performance, accuracy trends, and prediction explainability per domain" },
      ]}
    />
  );
}
