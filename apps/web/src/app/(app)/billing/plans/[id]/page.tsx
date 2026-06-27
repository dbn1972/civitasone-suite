import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatCard, StatGrid, EmptyState } from "../../../../_components/ds";
import { getBillingPlanById } from "../../../../_data/loaders";

export default async function PlanDetailPage({ params }: { params: { id: string } }) {
  const { data: plan, source } = await getBillingPlanById(params.id);

  if (!plan) {
    return (
      <main className="page-main" aria-labelledby="page-heading">
        <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <a href="/billing/plans">Plans</a> <span aria-hidden="true">›</span> Not found
        </nav>
        <PageHeader title="Plan Detail" back="/billing/plans" />
        <EmptyState icon="📋" title="Plan not found" message="This plan may have been removed or the ID is invalid." />
      </main>
    );
  }

  const name = (plan.name as string) ?? "Unnamed Plan";
  const description = (plan.description as string) ?? "";
  const amount = plan.amount != null ? String(plan.amount) : "—";
  const currency = (plan.currency as string) ?? "INR";
  const interval = (plan.interval as string) ?? "—";
  const status = (plan.status as string) ?? "active";
  const createdAt = (plan.createdAt as string) ?? "";

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <a href="/billing">Billing</a> <span aria-hidden="true">›</span>{" "}
        <a href="/billing/plans">Plans</a> <span aria-hidden="true">›</span>{" "}
        <span aria-current="page">{name}</span>
      </nav>

      <PageHeader
        title={name}
        subtitle={description || "Billing plan details"}
        back="/billing/plans"
      />

      {source === "error" && <DataSourceBadge source="error" />}

      <StatGrid>
        <StatCard icon="💰" iconBg="#ecfdf5" label="Amount" value={`${currency} ${amount}`} />
        <StatCard icon="🔄" iconBg="#eff6ff" label="Interval" value={interval} />
        <StatCard icon="📊" iconBg="#faf5ff" label="Status" value={status} />
        {createdAt && <StatCard icon="📅" iconBg="#fff7ed" label="Created" value={createdAt.slice(0, 10)} />}
      </StatGrid>

      <Card title="Plan details" padding>
        <div className="fields">
          <div className="field"><span className="label">Plan ID</span><span className="mono">{params.id}</span></div>
          <div className="field"><span className="label">Name</span><span>{name}</span></div>
          {description && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Description</span>
              <span>{description}</span>
            </div>
          )}
          <div className="field"><span className="label">Amount</span><span>{currency} {amount}</span></div>
          <div className="field"><span className="label">Interval</span><span>{interval}</span></div>
          <div className="field"><span className="label">Status</span><span>{status}</span></div>
        </div>
      </Card>
    </main>
  );
}
