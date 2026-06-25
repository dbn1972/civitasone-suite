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
      ]}
    />
  );
}
