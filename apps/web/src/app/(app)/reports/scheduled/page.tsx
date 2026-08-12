import { fetchJson } from "@/app/_data/apiClient";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { EmptyState, PageHeader, StatCard, StatGrid } from "@/app/_components/ds";
import { NewScheduledForm } from "./NewScheduledForm";

type ScheduledReport = {
  id: string;
  templateId: string;
  cadence: string;
  recipients: string[];
  format: string;
  enabled: boolean;
  nextRunAt: string | null;
};

type ScheduledListResponse = { data: ScheduledReport[]; meta?: { total?: number } };

async function getScheduledReports() {
  return fetchJson<ScheduledListResponse, ScheduledReport[]>(
    "/v1/reports/scheduled",
    [],
    {
      telemetryKey: "reports.scheduled.list",
      mapResponse: (r) => r.data ?? [],
    },
  );
}

const tdStyle: React.CSSProperties = { padding: "10px 12px", color: "var(--ink)" };
const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "var(--ink2)",
  fontWeight: 600,
  textAlign: "left",
};

export default async function ScheduledReportsPage() {
  const { data: schedules, source } = await getScheduledReports();

  const enabled = schedules.filter((s) => s.enabled).length;
  const disabled = schedules.length - enabled;

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Scheduled Reports"
        subtitle="Manage automated report delivery schedules."
      />

      <StatGrid>
        <StatCard label="Total Schedules" value={schedules.length} />
        <StatCard label="Enabled" value={enabled} up={enabled > 0} />
        <StatCard label="Disabled" value={disabled} />
      </StatGrid>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h">
          <h3>Schedules</h3>
        </div>
        {schedules.length === 0 ? (
          <EmptyState
            title="No scheduled reports"
            message="Create a schedule below to start automated delivery."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <th style={thStyle}>Template</th>
                  <th style={thStyle}>Cadence</th>
                  <th style={thStyle}>Recipients</th>
                  <th style={thStyle}>Format</th>
                  <th style={thStyle}>Enabled</th>
                  <th style={thStyle}>Next Run</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.75rem", color: "var(--ink2)" }}>
                      {s.templateId.slice(0, 8)}&hellip;
                    </td>
                    <td style={tdStyle}>{s.cadence}</td>
                    <td style={{ ...tdStyle, color: "var(--ink2)" }}>
                      {s.recipients.length} recipient{s.recipients.length !== 1 ? "s" : ""}
                    </td>
                    <td style={{ ...tdStyle, textTransform: "uppercase", fontSize: "0.75rem", fontWeight: 600 }}>
                      {s.format}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: s.enabled ? "var(--good)" : "var(--warn)", fontWeight: 600 }}>
                        {s.enabled ? "Yes" : "No"}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: "var(--ink2)", fontSize: "0.8125rem" }}>
                      {s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h">
          <h3>New Scheduled Report</h3>
        </div>
        <NewScheduledForm />
      </div>
    </div>
  );
}
