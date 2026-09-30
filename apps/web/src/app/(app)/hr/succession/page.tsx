/**
 * Succession Planning page — Sprint 14 / Lifecycle Phase 2
 * Renders the pipeline + risk API responses as CriticalPost cards with
 * real per-nominee readiness, and lets HR create critical roles/nominees.
 */
import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import {
  SuccessionPlanList,
  type CriticalPost,
  type Successor,
} from "./_components/SuccessionPlanCard";
import { CreatePlanForm } from "./_components/CreatePlanForm";

// GAP-HR-SUCCESSION-05: server enforces HR_ROLES on every succession route
// already (gap-features/routes.ts) -- this mirrors that same list so a
// non-HR caller admitted by hr/layout.tsx (employee, manager) gets an
// honest PermissionDenied instead of a raw 403 surfacing as a generic
// error. NOT a widening or narrowing of who has access: hr_officer already
// has server-side access today (HR_ROLES = hr_admin, super_admin,
// hr_officer), verified directly against gap-features/routes.ts.
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

/* ── API types ── */
type PipelineRow = {
  planId?: string;
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
  department?: string;
} & Record<string, unknown>;

type Department = { id: string; name: string };

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

async function getDepartments() {
  return fetchJson<unknown, Department[]>("/api/v1/hrms/departments", [], {
    telemetryKey: "hr.succession.departments",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Department[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

// GAP-HR-SUCCESSION-01: the API now returns real successors directly;
// synthesise()-ing placeholder "Nominee N" people is gone. A plan with
// nominee_count > 0 but somehow no successor rows (should not happen once
// -01's backend join is in place, kept as a defensive display fallback)
// shows the raw counts instead of fabricating names.
function buildPosts(rows: PipelineRow[]): CriticalPost[] {
  return rows.map((row, idx) => ({
    id: String(row.planId ?? row.role_ref ?? idx),
    roleRef: String(row.role_ref ?? "—"),
    department: row.department ? String(row.department) : undefined,
    currentHolder: row.currentHolder,
    retirementDate: row.retirementDate ?? null,
    riskLevel: row.riskLevel ?? null,
    successors: Array.isArray(row.successors) ? row.successors : [],
    nomineeCount: Number(row.nominee_count ?? 0),
  }));
}

export default async function SuccessionPage() {
  const t = await getTranslations("succession");
  const tCard = await getTranslations("successionPlanCard");
  const roles = getSessionRoles();
  const isHr = HR_ROLES.some((r) => roles.includes(r));

  if (!isHr) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PermissionDenied module={t("title")} requiredRoles={HR_ROLES} backHref="/hr" />
      </div>
    );
  }

  const [pipeResult, riskResult, deptResult] = await Promise.all([getPipeline(), getRisk(), getDepartments()]);
  const pipeline = pipeResult.data;
  const atRisk = riskResult.data;
  const departments = deptResult.data;
  const source =
    pipeResult.source === "error" || riskResult.source === "error" ? "error" : pipeResult.source;
  const pipelineErrored = pipeResult.source === "error";
  const riskErrored = riskResult.source === "error";
  // Whichever of the two calls actually failed carries the real reason
  // (e.g. a 403's backend message) -- prefer it over the other,
  // still-empty result so a genuine 403 doesn't get reported as a plain
  // network/5xx failure.
  const errorResult = pipelineErrored ? pipeResult : riskResult;

  const posts = buildPosts(pipeline);
  const readyNow = pipeline.reduce((s, r) => s + Number(r.ready_now ?? 0), 0);
  const totalNominees = pipeline.reduce((s, r) => s + Number(r.nominee_count ?? 0), 0);

  const RISK_COLS: { key: keyof RiskRow & string; label: string }[] = [
    { key: "role_ref", label: t("colRoleAtRisk") },
    { key: "department", label: t("colDepartment") },
  ];

  const roleOptions = pipeline
    .filter((r) => r.planId)
    .map((r) => ({ planId: String(r.planId), roleRef: String(r.role_ref ?? "") }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={source} />

      <StatGrid>
        {/* GAP-HR-SUCCESSION-04: '—' on a failed fetch, not 0 -- a failed
            load previously looked identical to "zero critical roles". */}
        <StatCard icon="🏆" iconBg="var(--infobg, #e6f0ff)" label={t("statCriticalRolesLabel")} value={pipelineErrored ? null : pipeline.length} />
        <StatCard icon="👥" iconBg="var(--bg, #f5f5f5)" label={t("statTotalNomineesLabel")} value={pipelineErrored ? null : totalNominees} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statReadyNowLabel")} value={pipelineErrored ? null : readyNow} />
        <StatCard icon="⚠️" iconBg="var(--badbg, #fff1f0)" label={t("statRolesAtRiskLabel")} value={riskErrored ? null : atRisk.length} />
      </StatGrid>

      {/* Rich succession plan cards */}
      <Card title={t("cardTitlePipeline")}>
        {pipelineErrored ? (
          <div className="pad">
            <LoadErrorState result={pipeResult} area="succession plans" backHref="/hr" />
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <SuccessionPlanList posts={posts} t={tCard} />
          </div>
        )}
      </Card>

      {/* GAP-HR-SUCCESSION-05: create UI -- POST /succession/critical-roles
          and /nominees existed with no way to reach them from this page. */}
      <div style={{ marginTop: 16 }}>
        <CreatePlanForm departments={departments} roles={roleOptions} />
      </div>

      {/* At-risk table. GAP-HR-SUCCESSION-04: rendered whenever the risk
          call itself succeeded (not gated on atRisk.length > 0), so the
          "all critical roles have ready successors" empty state is
          actually reachable, and a risk-call-only failure shows its own
          error instead of silently reading as "0 at risk". */}
      <div style={{ marginTop: 16 }}>
        <Card title={t("cardTitleAtRisk")}>
          {riskErrored ? (
            <div className="pad">
              <LoadErrorState result={errorResult} area="at-risk roles" backHref="/hr" />
            </div>
          ) : (
            <DataTable<RiskRow>
              columns={RISK_COLS}
              rows={atRisk}
              sortable
              pageSize={10}
              emptyIcon="⚠️"
              emptyTitle={t("emptyTitleAllReady")}
              emptyMessage=""
            />
          )}
        </Card>
      </div>
    </div>
  );
}
