import { PageHeader } from "../../../../_components/ds";
import { CreateReportForm } from "./CreateReportForm";

export default function NewReportPage({ searchParams }: { searchParams: { reportType?: string } }) {
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
          style={{ background: "#fffaeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 12, padding: "11px 14px", margin: "0 0 16px", fontSize: 13, maxWidth: 820 }}
        >
          ℹ️ The report service does not expose a KPI-targets command. This target is recorded as a
          report job (the closest available command).
        </div>
      )}
      <CreateReportForm defaultReportType={reportType} />
    </div>
  );
}
