/**
 * Succession Planning page — Sprint 14 / Lifecycle Phase 2
 * Transforms the pipeline + risk API responses into CriticalPost cards
 * with readiness level, skill gap indicators, and dev-plan link.
 */
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import {
  SuccessionPlanList,
  type CriticalPost,
  type Successor,
} from "./_components/SuccessionPlanCard";

/* ── API types ── */
type PipelineRow = {
  role_ref: string;
  department_id?: string;
  department?: string;
  nominee_count: number;
  ready_now: number;
  successors?: Successor[];
  currentHolder?: string;
  retirementDate?: string | null;
  riskLevel?: "high" | "medium" | "low" | null;
} & Record<string, unknown>;

type RiskRow = {
  role_ref: string;
  department_id?: string;
} & Record<string, unknown>;

async function getPipeline() {
  return fetchJson<unknown, PipelineRow[]>("/api/v1/hrms/succession/pipeline", [], {
    telemetryKey: "hr.succession.pipeline",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: PipelineRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getRisk() {
  return fetchJson<unknown, RiskRow[]>("/api/v1/hrms/succession/risk", [], {
    telemetryKey: "hr.succession.risk",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RiskRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

/**
 * Build CriticalPost[] from the pipeline API.
 * If the API already returns a `successors` array, we use it.
 * Otherwise we synthesise placeholder rows from the aggregate counts
 * so the card always renders meaningfully.
 */
function buildPosts(rows: PipelineRow[]): CriticalPost[] {
  return rows.map((row, idx) => {
    const successors: Successor[] =
      Array.isArray(row.successors) && row.successors.length > 0
        ? row.successors
        : synthesise(row);

    return {
      id:            String(row.role_ref ?? idx),
      roleRef:       String(row.role_ref ?? "—"),
      department:    String(row.department ?? row.department_id ?? ""),
      currentHolder: row.currentHolder,
      retirementDate: row.retirementDate ?? null,
      riskLevel:     row.riskLevel ?? (Number(row.ready_now) === 0 ? "high" : "medium"),
      successors,
    };
  });
}

function synthesise(row: PipelineRow): Successor[] {
  const total     = Number(row.nominee_count ?? 0);
  const readyNow  = Number(row.ready_now ?? 0);
  const results: Successor[] = [];
  for (let i = 0; i < readyNow; i++) {
    results.push({
      employeeId: `${row.role_ref}-rn-${i + 1}`,
      name:       `Nominee ${i + 1}`,
      readiness:  "ready_now",
    });
  }
  const remaining = total - readyNow;
  for (let i = 0; i < remaining; i++) {
    results.push({
      employeeId: `${row.role_ref}-ot-${i + 1}`,
      name:       `Nominee ${readyNow + i + 1}`,
      readiness:  i < remaining / 2 ? "one_two_years" : "three_five_years",
    });
  }
  return results;
}

const RISK_COLS: { key: keyof RiskRow & string; label: string }[] = [
  { key: "role_ref",     label: "Role at Risk" },
  { key: "department_id",label: "Department" },
];

export default async function SuccessionPage() {
  const [pipeResult, riskResult] = await Promise.all([getPipeline(), getRisk()]);
  const pipeline = pipeResult.data;
  const atRisk   = riskResult.data;
  const source   =
    pipeResult.source === "error" || riskResult.source === "error"
      ? "error"
      : pipeResult.source;

  const posts        = buildPosts(pipeline);
  const readyNow     = pipeline.reduce((s, r) => s + Number(r.ready_now ?? 0), 0);
  const totalNominees= pipeline.reduce((s, r) => s + Number(r.nominee_count ?? 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Succession Planning"
        subtitle="Critical role coverage — nominee pipeline, readiness levels, skill gaps, and key-person risk."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🏆" iconBg="#e6f0ff" label="Critical Roles"  value={pipeline.length} />
        <StatCard icon="👥" iconBg="#f5f5f5" label="Total Nominees"  value={totalNominees} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Ready Now"        value={readyNow} />
        <StatCard icon="⚠️" iconBg="#fff1f0" label="Roles at Risk"   value={atRisk.length} />
      </StatGrid>

      {/* Rich succession plan cards */}
      <Card title="Succession Pipeline — Critical Roles">
        <div style={{ padding: 16 }}>
          <SuccessionPlanList posts={posts} />
        </div>
      </Card>

      {/* At-risk table */}
      {atRisk.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Key-Person Risk — No Ready Successors">
            <DataTable<RiskRow>
              columns={RISK_COLS}
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
