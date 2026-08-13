import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type PipelineRow = {
  role_ref: string;
  department_id?: string;
  nominee_count: number;
  ready_now: number;
} & Record<string, unknown>;

type RiskRow = {
  role_ref: string;
  department_id?: string;
} & Record<string, unknown>;

async function getPipeline(): Promise<LoaderResult<PipelineRow[]>> {
  return fetchJson<unknown, PipelineRow[]>("/api/v1/hrms/succession/pipeline", [], {
    telemetryKey: "hr.succession.pipeline",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: PipelineRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getRisk(): Promise<LoaderResult<RiskRow[]>> {
  return fetchJson<unknown, RiskRow[]>("/api/v1/hrms/succession/risk", [], {
    telemetryKey: "hr.succession.risk",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RiskRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function SuccessionPage() {
  const [pipe, risk] = await Promise.all([getPipeline(), getRisk()]);
  const pipeline = pipe.data;
  const atRisk = risk.data;
  const source = pipe.source === "error" || risk.source === "error" ? "error" : pipe.source;

  const readyNow = pipeline.reduce((s, r) => s + Number(r.ready_now ?? 0), 0);
  const totalNominees = pipeline.reduce((s, r) => s + Number(r.nominee_count ?? 0), 0);

  const pipeCols: { key: keyof PipelineRow & string; label: string; align?: "left" | "right" }[] = [
    { key: "role_ref", label: "Critical Role" },
    { key: "nominee_count", label: "Total Nominees", align: "right" },
    { key: "ready_now", label: "Ready Now", align: "right" },
  ];

  const riskCols: { key: keyof RiskRow & string; label: string }[] = [
    { key: "role_ref", label: "Role at Risk" },
    { key: "department_id", label: "Department" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Succession Planning"
        subtitle="Critical role coverage, succession pipeline, and key-person risk management."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏆" iconBg="#e6f0ff" label="Critical Roles" value={pipeline.length} />
        <StatCard icon="👥" iconBg="#f5f5f5" label="Total Nominees" value={totalNominees} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Ready Now" value={readyNow} />
        <StatCard icon="⚠️" iconBg="#fff1f0" label="Roles at Risk" value={atRisk.length} />
      </StatGrid>
      <Card title="Succession Pipeline">
        <DataTable<PipelineRow>
          columns={pipeCols}
          rows={pipeline}
          sortable
          filterable
          filterPlaceholder="Filter by role…"
          pageSize={15}
          emptyIcon="🏆"
          emptyTitle="No succession plans created"
          emptyMessage="Succession plans for critical roles appear here. Each plan identifies nominees and tracks their readiness level for role assumption."
        />
      </Card>
      {atRisk.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Key-Person Risk — No Ready Successors">
            <DataTable<RiskRow>
              columns={riskCols}
              rows={atRisk}
              sortable
              pageSize={10}
              emptyIcon="⚠️"
              emptyTitle="All critical roles have ready successors"
              emptyMessage=""
            />
          </Card>
        </div>
      )}
    </main>
  );
}
