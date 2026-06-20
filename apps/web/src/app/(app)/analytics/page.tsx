import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Data & Analytics"
      description="Dashboards and query runs — API-backed list views."
      links={[{ href: "/analytics/list", label: "Dashboards", note: "Live data from Analytics service API" }]}
    />
  );
}
