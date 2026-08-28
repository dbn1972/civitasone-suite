import Link from "next/link";
import { fetchJson } from "@/app/_data/apiClient";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, DataTable, StatGrid, StatCard } from "@/app/_components/ds";
import { fmtDate } from "../../_data/format";
import { ExecutionActions } from "./ExecutionActions";

// ─── Types ────────────────────────────────────────────────────────────────────

// Mirrors a work_scopes row from GET /v1/works/execution/:workId/scopes — a raw
// select (works-service execution/repo.ts listScopes, schema.ts). The columns
// are { id, scopeId, targetValue, description, plannedStart, plannedEnd, ... };
// there is no scopeName / unit / status column and no scope-catalog join, so the
// label comes from `description` (optional) with a scopeId-derived fallback.
interface WorkScope {
  id: string;
  scopeId: string;
  description: string | null;
  targetValue: string;
  plannedStart: string | null;
  plannedEnd: string | null;
}

interface WorkIssue {
  id: string;
  workId: string;
  issueTypeId: string;
  description: string;
  raisedDate: string | null;
  status: string;
  priority: string;
}

// ─── Shape helpers ────────────────────────────────────────────────────────────

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
    id:           asStr(o.id, ""),
    scopeId:      asStr(o.scopeId, ""),
    description:  asNullableStr(o.description),
    targetValue:  o.targetValue == null ? "" : String(o.targetValue),
    plannedStart: asNullableStr(o.plannedStart),
    plannedEnd:   asNullableStr(o.plannedEnd),
  };
}

/** Display label for a scope: its description, else a scopeId-derived fallback
 *  (description is optional per addScopeSchema) so two scopes never collide. */
function scopeLabel(s: WorkScope, index: number): string {
  const desc = s.description?.trim();
  if (desc) return desc;
  if (s.scopeId) return `Scope ${s.scopeId.slice(0, 8)}…`;
  return `Scope ${index + 1}`;
}

function asWorkIssue(r: unknown): WorkIssue {
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  return {
    id:          asStr(o.id, ""),
    workId:      asStr(o.workId, ""),
    issueTypeId: asStr(o.issueTypeId, ""),
    description: asStr(o.description),
    raisedDate:  asNullableStr(o.raisedDate),
    status:      asStr(o.status, "open"),
    // Bug fix (works-deep-verify, LOW/L3): work_issues has no `priority`
    // column (execution/schema.ts) and nothing ever sends one (issues/new
    // form, createIssueSchema) — o.priority is always undefined from the
    // real API, so this unconditionally fabricated "medium" for every
    // issue, on every work, forever. The sibling Issues Register
    // (execution/issues/page.tsx) already renders this honestly as "—";
    // match that instead of inventing data.
    priority:    asStr(o.priority, "—"),
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ExecutionDetailPage({
  params,
}: {
  params: { workId: string };
}) {
  const { workId } = params;

  const [scopesResult, issuesResult] = await Promise.all([
    fetchJson<unknown, WorkScope[]>(
      `/api/v1/works/execution/${workId}/scopes`,
      [],
      {
        telemetryKey: "works.execution.detail.scopes",
        mapResponse: (p) => pickDataArray(p).map(asWorkScope),
      },
    ),
    fetchJson<unknown, WorkIssue[]>(
      `/api/v1/works/execution/${workId}/issues`,
      [],
      {
        telemetryKey: "works.execution.detail.issues",
        mapResponse: (p) => pickDataArray(p).map(asWorkIssue),
      },
    ),
  ]);

  const scopes = scopesResult.data;
  const issues = issuesResult.data;
  const loadFailed = scopesResult.source === "error" || issuesResult.source === "error";

  // ── Stats ──────────────────────────────────────────────────────────────────
  // work_scopes has no per-scope completion/status field, so overall progress
  // cannot be derived here (real progress lives in scope_progress, not on this
  // payload) — show only counts that are actually backed by the response.
  const totalScopes  = scopes.length;
  const openIssues   = issues.filter((i) => i.status === "open").length;
  const closedIssues = issues.filter((i) => i.status !== "open").length;

  // ── DataTable rows ─────────────────────────────────────────────────────────
  const scopeRows: Record<string, unknown>[] = scopes.map((s, i) => ({
    id:     s.id,
    scope:  scopeLabel(s, i),
    target: s.targetValue || "—",
    start:  fmtDate(s.plannedStart),
    end:    fmtDate(s.plannedEnd),
  }));

  const issueRows: Record<string, unknown>[] = issues.map((i) => ({
    id:          i.id,
    description: i.description,
    priority:    i.priority,
    raisedDate:  fmtDate(i.raisedDate),
    status:      i.status,
  }));

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Execution Progress"
        subtitle={`Work ${params.workId.slice(0, 8)}…`}
        back="/works/execution"
        backLabel="Execution"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {loadFailed && (
              <DataSourceBadge source="error" message="Couldn't load this work — some details may be missing." />
            )}
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
        <StatCard icon="🏗️" iconBg="#eff6ff" label="Total Scopes"  value={totalScopes} />
        <StatCard icon="🚨" iconBg="#fef2f2" label="Open Issues"   value={openIssues} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Closed Issues" value={closedIssues} />
      </StatGrid>

      <Card title="Work Scopes">
        <DataTable
          columns={[
            { key: "scope",  label: "Scope" },
            { key: "target", label: "Target", align: "right" },
            { key: "start",  label: "Start" },
            { key: "end",    label: "End" },
          ]}
          rows={scopeRows}
          emptyIcon="🏗️"
          emptyTitle="No scopes defined"
          emptyMessage="Work scopes will appear here once defined."
        />
      </Card>

      <Card title="Issues">
        <DataTable
          columns={[
            { key: "description", label: "Description" },
            { key: "priority",    label: "Priority" },
            { key: "raisedDate",  label: "Raised" },
            { key: "status",      label: "Status", cellType: "status" },
          ]}
          rows={issueRows}
          emptyIcon="✅"
          emptyTitle="No open issues"
          emptyMessage="Issues raised against this work will appear here."
        />
      </Card>

      <ExecutionActions workId={params.workId} />
    </main>
  );
}
