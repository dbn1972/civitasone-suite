import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, LoadErrorState, StatusPill } from "@/app/_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import type { RunRow } from "../RunsTable";
import { ExceptionsPanel, type ExceptionRow } from "../ExceptionsPanel";
import { canActOnExceptions, isRunInProgress, unmatchedCount } from "../reconHelpers";

type RunDetail = { data: RunRow | null; breaks: ExceptionRow[] };

async function getRunDetail(id: string): Promise<LoaderResult<RunDetail>> {
  return fetchJson<unknown, RunDetail>(`/api/v1/finance/recon/runs/${encodeURIComponent(id)}`, { data: null, breaks: [] }, {
    telemetryKey: "finance.recon.run-detail",
    mapResponse: (p) => {
      const payload = p as { data?: RunRow; breaks?: ExceptionRow[] } | null;
      if (!payload || !payload.data) return null;
      return { data: payload.data, breaks: Array.isArray(payload.breaks) ? payload.breaks : [] };
    },
  });
}

export default async function ReconciliationRunDetailPage({ params }: { params: { id: string } }) {
  const result = await getRunDetail(params.id);
  const { data: detail, source } = result;
  const run = detail.data;

  if (!run) {
    // fetchJson reports a 404 as source "error" with status 404, so "run not
    // found" and "the load failed" must be told apart by status, not by
    // `source` (the old notFound() branch was unreachable). A real 404 gets an
    // in-chrome message; any other failure gets a retryable error state
    // (GAP-FINANCE-RECONCILIATION-DETAIL-03).
    const failed = source === "error" && result.status !== 404;
    return (
      <div className="page-main wrap">
        <PageHeader
          title="Reconciliation Run"
          back="/finance/reconciliation"
          backLabel="Reconciliation Workbench"
        />
        {failed ? (
          <LoadErrorState result={result} area="reconciliation run" backHref="/finance/reconciliation" backLabel="Reconciliation Workbench" />
        ) : (
          <EmptyState
            icon="🔁"
            title="Run not found"
            message="This reconciliation run does not exist or is no longer available. Return to the workbench to pick another run."
          />
        )}
      </div>
    );
  }

  const canAct = canActOnExceptions(getSessionRoles());
  const inProgress = isRunInProgress(run.status);
  const sourceUnmatched = unmatchedCount(run.sourceCount, run.matchedCount);
  const targetUnmatched = unmatchedCount(run.targetCount, run.matchedCount);

  return (
    <div className="page-main wrap">
      <PageHeader
        title={`Recon Run — ${run.provider}`}
        subtitle={`${run.sourceSystem} ↔ ${run.targetSystem} · started ${formatIndianDate(run.startedAt)}${
          run.completedAt ? ` · completed ${formatIndianDate(run.completedAt)}` : ""
        }`}
        back="/finance/reconciliation"
        backLabel="Reconciliation Workbench"
        actions={
          <>
            <StatusPill status={run.status} />
            {source === "error" ? <DataSourceBadge source="error" /> : null}
          </>
        }
      />

      {inProgress && (
        <p role="status" className="pill warn" style={{ width: "fit-content", marginBottom: 12 }}>
          Run still in progress; counts may change.
        </p>
      )}

      <StatGrid>
        <StatCard icon="📥" iconBg="#eff6ff" label="Source Count" value={run.sourceCount} />
        <StatCard icon="📤" iconBg="#ecfdf3" label="Target Count" value={run.targetCount} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Matched" value={run.matchedCount} />
        {/* While a run is still moving, "Unbalanced" is not a verdict yet. */}
        <StatCard
          icon="⚠️"
          iconBg="#fef3f2"
          label="Breaks"
          value={run.breakCount}
          {...(inProgress ? {} : { delta: run.balanced ? "Balanced" : "Unbalanced", up: run.balanced })}
        />
      </StatGrid>

      <p style={{ margin: "0 0 16px", color: "var(--ink2)", fontSize: 13 }}>
        Unmatched rows: <strong>{sourceUnmatched}</strong> in {run.sourceSystem}, <strong>{targetUnmatched}</strong> in{" "}
        {run.targetSystem}.{" "}
        <a href="#exceptions" aria-label={`View ${run.breakCount} breaks for this run`}>
          View breaks
        </a>
      </p>

      <div id="exceptions">
        <Card title="Exceptions for this run">
          <ExceptionsPanel exceptions={detail.breaks} canAct={canAct} />
        </Card>
      </div>
    </div>
  );
}
