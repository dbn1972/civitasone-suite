import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader, StatGrid, StatCard, Card, StatusPill, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getAnalyticsDashboardById } from "../../_data";
import { toHumanError } from "@/lib/messages";

// GAP-ANALYTICS-DASHBOARDS-01: the Dashboards list promised "widgets, layout
// and owner/shared access control" but no detail route existed to show it.
// The analytics service already serves GET /api/v1/analytics/dashboards/:id
// with its own access enforcement (returns 404 when the caller may not view
// it), so this page just renders it. Private-visibility rows a caller cannot
// see come back as 404 server-side — we never widen access here.
export default async function AnalyticsDashboardDetailPage({ params }: { params: { id: string } }) {
  const { data: dashboard, source, status } = await getAnalyticsDashboardById(params.id);

  // A real 404 ("doesn't exist / not visible to you") is distinct from a
  // transient load failure: the former should render the not-found page, the
  // latter a retryable error.
  if (source === "error" && status === 404) notFound();

  if (source === "error" || !dashboard) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <nav aria-label="Breadcrumb" className="back">
          <ArrowLeft aria-hidden="true" size={14} /> <a href="/analytics/dashboards">Dashboards</a>
        </nav>
        <PageHeader title="Dashboard" subtitle="Saved analytics dashboard." />
        <Card title="Dashboard">
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "this dashboard" })} backHref="/analytics/dashboards" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/analytics/dashboards">Dashboards</a>
      </nav>
      <PageHeader title={dashboard.name} subtitle={dashboard.description ?? "Saved analytics dashboard."} />
      <StatGrid>
        <StatCard icon="📊" tone="info" label="Widgets" value={dashboard.widgets.length} />
        <StatCard icon="🔗" tone="good" label="Shared with" value={dashboard.shareCount} />
        <StatCard icon="📄" tone="info" label="Version" value={`v${dashboard.version}`} />
      </StatGrid>

      <Card title="Details">
        <dl className="pad" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 24px", margin: 0 }}>
          <dt>Status</dt>
          <dd><StatusPill status={dashboard.status} /></dd>
          <dt>Visibility</dt>
          <dd><StatusPill status={dashboard.visibility} /></dd>
          <dt>Owner</dt>
          <dd>{dashboard.ownerId ? <span className="mono" title={dashboard.ownerId}>{dashboard.ownerId.slice(0, 8)}</span> : "—"}</dd>
        </dl>
      </Card>

      <Card title="Widgets">
        {dashboard.widgets.length === 0 ? (
          <EmptyState icon="📊" title="No widgets" message="This dashboard has no widgets yet." />
        ) : (
          <ul className="pad" style={{ margin: 0, paddingInlineStart: 18 }}>
            {dashboard.widgets.map((w) => (
              <li key={w.id}>
                {w.title} <span style={{ color: "var(--ink2, #64748b)" }}>· {w.vizType}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
