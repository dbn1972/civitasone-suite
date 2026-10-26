import { PageHeader } from "../../../../_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { CreateReportForm } from "./CreateReportForm";

export default async function NewReportPage(props: { searchParams: Promise<{ reportType?: string }> }) {
  const searchParams = await props.searchParams;
  const reportType = typeof searchParams.reportType === "string" ? searchParams.reportType : "";
  const isKpiTarget = reportType === "kpi-target";

  return (
    <div className="wrap">
      <PageHeader
        title={isKpiTarget ? "Set KPI Targets" : "New Report"}
        subtitle={isKpiTarget
          ? "Define a KPI target. Recorded as a report job pending a dedicated KPI-targets endpoint."
          : "Queue a report generation job."}
        back="/reports/list"
      />
      {isKpiTarget && (
        <div
          className="banner"
          style={{ background: "var(--warnbg)", border: "1px solid var(--warn)", color: "var(--warn)", borderRadius: 12, padding: "11px 14px", margin: "0 0 16px", fontSize: 13, maxWidth: 820 }}
        >
          <span aria-hidden>ℹ️</span> The report service does not expose a KPI-targets command. This target is recorded as a
          report job (the closest available command).
        </div>
      )}
      <CreateReportForm defaultReportType={reportType} canUnmaskPii={getSessionRoles().includes("report_admin")} />
    </div>
  );
}
