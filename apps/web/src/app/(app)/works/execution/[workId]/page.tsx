import Link from "next/link";
import { fetchJson } from "@/app/_data/apiClient";
import { PageHeader, Card, DataTable, StatGrid, StatCard, ProgressBar } from "@/app/_components/ds";
import { fmtDate } from "../../_data/format";
import { ExecutionActions } from "./ExecutionActions";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkScope {
  id: string;
  workId: string;
  scopeName: string;
  targetQuantity: string;
  unit: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
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
    id:             asStr(o.id, ""),
    workId:         asStr(o.workId, ""),
    scopeName:      asStr(o.scopeName),
    targetQuantity: asStr(o.targetQuantity, "0"),
    unit:           asStr(o.unit),
    startDate:      asNullableStr(o.startDate),
    endDate:        asNullableStr(o.endDate),
    status:         asStr(o.status, "active"),
  };
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
    priority:    asStr(o.priority, "medium"),
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

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalScopes     = scopes.length;
  const completedScopes = scopes.filter((s) => s.status === "completed").length;
  const overallPct      = totalScopes > 0 ? Math.round((completedScopes / totalScopes) * 100) : 0;
  const openIssues      = issues.filter((i) => i.status === "open").length;
  const closedIssues    = issues.filter((i) => i.status !== "open").length;

  // ── DataTable rows ─────────────────────────────────────────────────────────
  const scopeRows: Record<string, unknown>[] = scopes.map((s) => ({
    id:             s.id,
    scopeName:      s.scopeName,
    targetQuantity: s.targetQuantity,
    unit:           s.unit,
    startDate:      fmtDate(s.startDate),
    endDate:        fmtDate(s.endDate),
    status:         s.status,
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

      <Card title="Overall Progress" padding>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <ProgressBar value={overallPct} />
          <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "var(--ink)", minWidth: 48 }}>
            {overallPct}%
          </span>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
          {completedScopes} of {totalScopes} scope{totalScopes !== 1 ? "s" : ""} completed
        </p>
      </Card>

      <Card title="Work Scopes">
        <DataTable
          columns={[
            { key: "scopeName",      label: "Scope" },
            { key: "targetQuantity", label: "Target Qty", align: "right" },
            { key: "unit",           label: "Unit" },
            { key: "startDate",      label: "Start" },
            { key: "endDate",        label: "End" },
            { key: "status",         label: "Status", cellType: "status" },
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
