import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    // GAP-REPORTS-HOME-01: the "Executive Summary" tile linked to
    // /reports/executive-summary, which has no web route — every click fell
    // through to the dynamic /reports/[id] segment and showed the misleading
    // "Report job not found… the ID is incorrect" detail page. There is a
    // report-service executive-summary endpoint but no web page/loader wired to
    // it, so building the route is out of scope here; the honest fix is to
    // remove the dead tile rather than advertise a link that only bounces the
    // user to a wrong error. (Decision: remove, not "coming soon" — a non-link
    // "coming soon" tile is not supported by the shared ModuleHub/LinkTiles.)
    // GAP-REPORTS-HOME-03: group tiles into read-only "View" and action
    // "Reports" so viewing and generating are visually separated.
    <ModuleHub
      title="Reports & Analytics"
      description="Dashboards, KPI tracking, MIS, and report job management."
      groups={[
        {
          heading: "View",
          links: [
            { href: "/reports/dashboard", label: "Dashboard", note: "KPI overview and module activity" },
            { href: "/reports/kpi", label: "KPI Tracker", note: "Performance vs targets" },
            { href: "/reports/mis", label: "MIS Dashboard", note: "Management information system" },
          ],
        },
        {
          heading: "Reports",
          links: [
            { href: "/reports/list", label: "Report Jobs", note: "All generated reports" },
            { href: "/reports/scheduled", label: "Scheduled Reports", note: "Manage automated report delivery schedules." },
          ],
        },
      ]}
    />
  );
}
