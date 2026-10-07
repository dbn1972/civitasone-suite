import { fetchJson } from "@/app/_data/apiClient";
import { getReportTemplates } from "@/app/_data/loaders";
import { EmptyState, PageHeader, StatCard, StatGrid, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { NewScheduledForm } from "./NewScheduledForm";
import { ScheduledTable, type ScheduledRow } from "./ScheduledTable";

type ScheduledReport = {
  id: string;
  templateId: string;
  cadence: string;
  recipients: string[];
  format: string;
  enabled: boolean;
  nextRunAt: string | null;
  version: number;
};

type ScheduledListResponse = { data: ScheduledReport[]; meta?: { total?: number } };

async function getScheduledReports() {
  return fetchJson<ScheduledListResponse, ScheduledReport[]>(
    "/v1/reports/scheduled",
    [],
    {
      telemetryKey: "reports.scheduled.list",
      mapResponse: (r) =>
        (r.data ?? []).map((s) => ({
          ...s,
          // version is needed by the row actions' optimistic-locked PATCH;
          // default to 1 when an older contract omits it.
          version: typeof s.version === "number" ? s.version : 1,
        })),
    },
  );
}

export default async function ScheduledReportsPage() {
  const [{ data: schedules, source }, { data: templates }] = await Promise.all([
    getScheduledReports(),
    getReportTemplates(),
  ]);

  const errored = source === "error";

  // GAP-REPORTS-SCHEDULED-01: resolve each schedule's templateId to its name.
  const templateNames = new Map(templates.map((t) => [t.id, t.name]));
  const rows: ScheduledRow[] = schedules.map((s) => ({
    ...s,
    templateName: templateNames.get(s.templateId) ?? "Unknown template",
  }));

  const enabled = schedules.filter((s) => s.enabled).length;
  const disabled = schedules.length - enabled;

  return (
    <div className="wrap">
      <PageHeader
        title="Scheduled Reports"
        subtitle="Manage automated report delivery schedules."
      />

      <StatGrid>
        {/* GAP-REPORTS-SCHEDULED-05: on error pass null so cards read "—"
            instead of a fabricated 0 (same masking fix as the MIS/LIST pages). */}
        <StatCard icon="📅" iconBg="var(--panel)" label="Total Schedules" value={errored ? null : schedules.length} />
        <StatCard icon="✅" iconBg="var(--panel)" label="Enabled" value={errored ? null : enabled} up={enabled > 0} />
        <StatCard icon="⏸️" iconBg="var(--panel)" label="Disabled" value={errored ? null : disabled} />
      </StatGrid>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h">
          <h3>Schedules</h3>
        </div>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "scheduled reports" })} backHref="/reports" />
        ) : schedules.length === 0 ? (
          <EmptyState
            title="No scheduled reports"
            message="Create a schedule below to start automated delivery."
          />
        ) : (
          <ScheduledTable rows={rows} />
        )}
      </div>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h">
          <h3>New Scheduled Report</h3>
        </div>
        <NewScheduledForm templates={templates} />
      </div>
    </div>
  );
}
