import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Reports & Analytics"
      description="Dashboards, KPI tracking, MIS, and report job management."
      links={[
        { href: "/reports/dashboard", label: "Dashboard", note: "KPI overview and module activity" },
        { href: "/reports/list", label: "Report Jobs", note: "All generated reports" },
        { href: "/reports/kpi", label: "KPI Tracker", note: "Performance vs targets" },
        { href: "/reports/mis", label: "MIS Dashboard", note: "Management information system" },
      ]}
    />
  );
}
