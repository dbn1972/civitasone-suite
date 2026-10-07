import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getAnalyticsQueryRuns } from "../_data";
import { QueryResultsView } from "./QueryResultsView";
import { RunQueryForm } from "./RunQueryForm";
import { ArrowLeft } from "lucide-react";

export default async function AnalyticsQueriesPage() {
  const { data: runs, source } = await getAnalyticsQueryRuns();

  // GAP-ANALYTICS-QUERIES-01: `source` was fetched (and handed to
  // QueryResultsView's badge, UX-012) but never gated the stat values. On a
  // failed load `runs` defaults to `[]`, so "Runs 0 / Completed 0 / Failed 0"
  // was indistinguishable from a tenant that genuinely has no runs yet. Gate
  // every stat on it, same "—" convention as dashboards/page.tsx (UX-013).
  const errored = source === "error";

  const completed = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed").length;

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/analytics">Analytics</a>
      </nav>
      <PageHeader
        title="Query Results"
        subtitle="Recent query runs. Every query is built from the whitelisted metric registry — no raw SQL, tenant-scoped."
      />
      {/* UX-012: the data-source badge now lives inside QueryResultsView,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}

      <div aria-label="Analytics query results">
        {/* ── Section 1: Run a new query ──────────────────────────────────── */}
        <Card title="Run a new query">
          <div style={{ padding: "16px 20px" }}>
            <RunQueryForm />
          </div>
        </Card>

        {/* ── Section 2: Recent results ───────────────────────────────────── */}
        <section aria-label="Recent results" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#0f172a", margin: "0 0 12px" }}>
            Recent results
          </h2>
          <StatGrid>
            <StatCard icon="🧮" iconBg="#f1f5f9" label="Runs" value={errored ? "—" : runs.length} />
            <StatCard icon="✅" iconBg="#dcfce7" label="Completed" value={errored ? "—" : completed} />
            <StatCard icon="⚠️" iconBg="#fee2e2" label="Failed" value={errored ? "—" : failed} />
          </StatGrid>
          <Card title="Query runs">
            <QueryResultsView runs={runs} source={source} />
          </Card>
        </section>
      </div>
    </>
  );
}
