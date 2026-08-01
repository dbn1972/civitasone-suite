import { notFound } from "next/navigation";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import type { RunRow } from "../RunsTable";
import { ExceptionsPanel, type ExceptionRow } from "../ExceptionsPanel";

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
  const { data: detail, source } = await getRunDetail(params.id);
  const run = detail.data;

  if (!run && source !== "error") {
    notFound();
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={run ? `Recon Run — ${run.provider}` : "Reconciliation Run"}
        subtitle={run ? `${run.sourceSystem} ↔ ${run.targetSystem} · started ${formatIndianDate(run.startedAt)}` : undefined}
        back="/finance/reconciliation"
        backLabel="Reconciliation Workbench"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      {run ? (
        <>
          <StatGrid>
            <StatCard icon="📥" iconBg="#eff6ff" label="Source Count" value={run.sourceCount} />
            <StatCard icon="📤" iconBg="#ecfdf3" label="Target Count" value={run.targetCount} />
            <StatCard icon="✅" iconBg="#fffaeb" label="Matched" value={run.matchedCount} />
            <StatCard icon="⚠️" iconBg="#fef3f2" label="Breaks" value={run.breakCount} delta={run.balanced ? "Balanced" : "Unbalanced"} up={run.balanced} />
          </StatGrid>

          <Card title="Exceptions for this run">
            <ExceptionsPanel exceptions={detail.breaks} />
          </Card>
        </>
      ) : (
        <Card title="Reconciliation Run">
          <DataSourceBadge source="error" />
        </Card>
      )}
    </main>
  );
}
