import Link from "next/link";
import { fetchJson } from "@/app/_data/apiClient";
import { PageHeader, Card, DataTable, StatGrid, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { fmtDate } from "../../_data/format";
import { getWorkHeader, getWorkProgress } from "../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canManageWorkClosure } from "@/lib/auth/workRoles";
import { ExecutionActions } from "./ExecutionActions";

// Mirrors a work_scopes row from GET /v1/works/execution/:workId/scopes.
interface WorkScope {
  id: string;
  scopeId: string;
  description: string | null;
  targetValue: string;
  plannedStart: string | null;
  plannedEnd: string | null;
}

// GAP-WORKS-EXECUTION-WORKID-03: no `priority` — work_issues has no such
// column and nothing ever sends one; rendering it was an always-"—" stub.
interface WorkIssue {
  id: string;
  workId: string;
  issueTypeId: string;
  description: string;
  raisedDate: string | null;
  status: string;
}

function pickDataArray(payload: unknown): unknown[] {
  if (payload && typeof payload === "object" && "data" in payload) {
    const d = (payload as { data: unknown }).data;
    return Array.isArray(d) ? d : [];
  }
  return Array.isArray(payload) ? payload : [];
}

function asStr(v: unknown, fallback = "—"): string {
  if (typeof v === "string") return v.length > 0 ? v : fallback;
  return v == null ? fallback : String(v);
}

function asNullableStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asWorkScope(r: unknown): WorkScope {
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  return {
    id: asStr(o.id, ""),
    scopeId: asStr(o.scopeId, ""),
    description: asNullableStr(o.description),
    targetValue: o.targetValue == null ? "" : String(o.targetValue),
    plannedStart: asNullableStr(o.plannedStart),
    plannedEnd: asNullableStr(o.plannedEnd),
  };
}

function scopeLabel(s: WorkScope, index: number): string {
  const desc = s.description?.trim();
  if (desc) return desc;
  if (s.scopeId) return `Scope ${s.scopeId.slice(0, 8)}…`;
  return `Scope ${index + 1}`;
}

function asWorkIssue(r: unknown): WorkIssue {
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  return {
    id: asStr(o.id, ""),
    workId: asStr(o.workId, ""),
    issueTypeId: asStr(o.issueTypeId, ""),
    description: asStr(o.description),
    raisedDate: asNullableStr(o.raisedDate),
    status: asStr(o.status, "open"),
  };
}

export default async function ExecutionDetailPage({
  params,
}: {
  params: { workId: string };
}) {
  const { workId } = params;

  const canManage = canManageWorkClosure(getSessionRoles());

  const [headerResult, scopesResult, issuesResult, progressResult] = await Promise.all([
    getWorkHeader(workId),
    fetchJson<unknown, WorkScope[]>(`/api/v1/works/execution/${workId}/scopes`, [], {
      telemetryKey: "works.execution.detail.scopes",
      mapResponse: (p) => pickDataArray(p).map(asWorkScope),
    }),
    fetchJson<unknown, WorkIssue[]>(`/api/v1/works/execution/${workId}/issues`, [], {
      telemetryKey: "works.execution.detail.issues",
      mapResponse: (p) => pickDataArray(p).map(asWorkIssue),
    }),
    getWorkProgress(workId),
  ]);

  const scopes = scopesResult.data;
  const issues = issuesResult.data;
  const progress = progressResult.data;

  // GAP-WORKS-EXECUTION-WORKID-05: each section tracks its OWN fetch, so a
  // partial failure shows a retry state in that section only — never a
  // zero-count table that masks the error.
  const scopesFailed = scopesResult.source === "error";
  const issuesFailed = issuesResult.source === "error";
  const progressFailed = progressResult.source === "error";

  // GAP-WORKS-EXECUTION-WORKID-01: title shows the real work number +
  // description; on failure falls back to "Work" (never a UUID prefix).
  const header = headerResult.data;
  const subtitle = header.workNumber
    ? `${header.workNumber}${header.description ? ` — ${header.description}` : ""}`
    : "Work";

  // GAP-WORKS-EXECUTION-WORKID-04: latest % achieved per scope id.
  const pctByScopeId = new Map<string, number>();
  for (const p of progress) {
    const sid = String(p.scopeId ?? "");
    if (sid && !pctByScopeId.has(sid)) pctByScopeId.set(sid, Number(p.percentage ?? 0));
  }

  const totalScopes = scopes.length;
  const openIssues = issues.filter((i) => i.status === "open").length;
  const closedIssues = issues.filter((i) => i.status !== "open").length;

  const scopeRows: Record<string, unknown>[] = scopes.map((s, i) => {
    const pct = pctByScopeId.get(s.scopeId);
    return {
      id: s.id,
      scope: scopeLabel(s, i),
      target: s.targetValue || "—",
      // On a progress-fetch error show "—", not a misleading 0%.
      achieved: progressFailed ? "—" : pct == null ? "—" : `${Math.round(pct)}%`,
      progress: progressFailed || pct == null ? null : pct,
      start: fmtDate(s.plannedStart),
      end: fmtDate(s.plannedEnd),
    };
  });

  const issueRows: Record<string, unknown>[] = issues.map((i) => ({
    id: i.id,
    description: i.description,
    raisedDate: fmtDate(i.raisedDate),
    status: i.status,
  }));

  const loadError = toHumanError("load");

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Execution Progress"
        subtitle={subtitle}
        back="/works/execution"
        backLabel="Execution"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link
              href={"/works/execution/record-progress?workId=" + params.workId}
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Record progress
            </Link>
            <Link
              href={"/works/execution/issues/new?workId=" + params.workId}
              className="btn ghost"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Raise issue
            </Link>
            <Link
              href={"/works/execution/photos/new?workId=" + params.workId}
              className="btn ghost"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              📷 Add photo
            </Link>
          </div>
        }
      />

      <StatGrid>
        <StatCard icon="🏗️" iconBg="#eff6ff" label="Total Scopes" value={scopesFailed ? null : totalScopes} />
        <StatCard icon="🚨" iconBg="#fef2f2" label="Open Issues" value={issuesFailed ? null : openIssues} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Closed Issues" value={issuesFailed ? null : closedIssues} />
      </StatGrid>

      <Card title="Work Scopes">
        {scopesFailed ? (
          <RefreshErrorState error={{ ...loadError, actions: ["retry", "back"] }} backHref="/works/execution" source={{ area: "work scopes", status: 500 }} />
        ) : (
          <DataTable
            columns={[
              { key: "scope", label: "Scope" },
              { key: "target", label: "Target", align: "right" },
              { key: "achieved", label: "Achieved", align: "right" },
              { key: "start", label: "Start" },
              { key: "end", label: "End" },
            ]}
            rows={scopeRows}
            emptyIcon="🏗️"
            emptyTitle="No scopes defined"
            emptyMessage="Work scopes will appear here once defined."
          />
        )}
      </Card>

      <Card title="Issues">
        {issuesFailed ? (
          <RefreshErrorState error={{ ...loadError, actions: ["retry", "back"] }} backHref="/works/execution" source={{ area: "issues", status: 500 }} />
        ) : (
          <DataTable
            columns={[
              { key: "description", label: "Description" },
              { key: "raisedDate", label: "Raised" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={issueRows}
            emptyIcon="✅"
            emptyTitle="No issues raised"
            emptyMessage="Issues raised against this work will appear here."
          />
        )}
      </Card>

      <ExecutionActions workId={params.workId} canManage={canManage} openIssues={issuesFailed ? null : openIssues} />
    </div>
  );
}
