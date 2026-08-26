import { PageHeader, StatGrid, StatCard, StatusPill, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getFinanceSchemeById } from "@/app/_data/loaders";
import { formatIndianDate, formatMoney } from "@/lib/formatters";

/**
 * Scheme detail. Previously 100% hardcoded fake data ("PM Gram Sadak Yojana",
 * fixed milestone/release tables) with `params.id` never read — now wired to
 * the real GET /v1/finance/schemes/:id loader (same one the scheme-tracking
 * list already uses for its row links). That backend route does not exist
 * yet (see FinanceSchemeSummary's "no live GET route" note in
 * packages/types), so today this honestly falls into the empty state below;
 * once finance-service ships the route, real data flows through
 * automatically with no further frontend change. The fabricated milestones
 * and fund-release tables are dropped rather than kept fake — the real
 * scheme record carries no such fields today.
 */
export default async function SchemeDetailPage({ params }: { params: { id: string } }) {
  const { data: scheme, source } = await getFinanceSchemeById(params.id);

  if (!scheme) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Scheme Detail" back="/finance/expenditure/scheme-tracking" />
        <EmptyState
          icon="🎯"
          title="Scheme detail not available"
          message="This scheme may not exist, or scheme detail lookup isn't available yet. Check Scheme Tracking for the current list."
        />
      </main>
    );
  }

  const outlay = Number(scheme.outlayMinor);
  const utilised = Number(scheme.utilisedMinor);
  const utilisationPct = outlay > 0 ? Math.round((utilised / outlay) * 100) : 0;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={scheme.name}
        subtitle={scheme.funding ?? scheme.code}
        back="/finance/expenditure/scheme-tracking"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label="Outlay" value={formatMoney(scheme.outlayMinor)} />
        <StatCard icon="📤" iconBg="#e7edfd" label="Utilised" value={formatMoney(scheme.utilisedMinor)} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Utilisation" value={`${utilisationPct}%`} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Status" value={scheme.status} />
      </StatGrid>

      <Card title="Scheme Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Code</span><span className="mono">{scheme.code}</span></div>
          <div className="field"><span className="label">Name</span><span>{scheme.name}</span></div>
          <div className="field"><span className="label">Funding</span><span>{scheme.funding ?? "—"}</span></div>
          <div className="field"><span className="label">Currency</span><span>{scheme.currency}</span></div>
          <div className="field"><span className="label">Outlay</span><span>{formatMoney(scheme.outlayMinor)}</span></div>
          <div className="field"><span className="label">Utilised</span><span>{formatMoney(scheme.utilisedMinor)}</span></div>
          <div className="field"><span className="label">Created</span><span>{formatIndianDate(scheme.createdAt)}</span></div>
          <div className="field"><span className="label">Last Updated</span><span>{formatIndianDate(scheme.updatedAt)}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={scheme.status} /></div>
        </div>
      </Card>
    </main>
  );
}
