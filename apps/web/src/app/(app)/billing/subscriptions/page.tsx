import Link from "next/link";
import { PageHeader, Card, StatCard, StatGrid, EmptyState, StatusPill, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";

// GAP-BILLING-SUBSCRIPTIONS-01/02/03: the billing-service GET
// /v1/billing/subscriptions returns the CALLER'S OWN subscription — a single
// SubscriptionSummary object (or null), NOT an array, and it carries NO churn
// score (subscriptions/routes.ts + domain.ts SubscriptionView). The old page
// fed this single object through the generic list mapper + a SubscriptionsTable
// that declared a `churnRisk` column + PredictionBadge path which could never
// render (the data never existed). This page shows the one subscription
// honestly and the dead churn column + its PredictionBadge import are removed.
interface SubscriptionSummary {
  id: string;
  plan: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  activeUsers: number | null;
  currency: string | null;
}

async function getSubscription(): Promise<LoaderResult<SubscriptionSummary | null>> {
  return fetchJson<unknown, SubscriptionSummary | null>("/api/v1/billing/subscriptions", null, {
    telemetryKey: "billing.subscription",
    mapResponse: (p) => {
      // A tenant with no subscription is a valid state: the endpoint replies
      // 200 with `null`. Keep that as a successful null (empty state), distinct
      // from a parse failure.
      if (p === null) return null;
      if (!p || typeof p !== "object") return null;
      const rec = p as Record<string, unknown>;
      if (typeof rec.id !== "string") return null;
      return {
        id: rec.id,
        plan: typeof rec.plan === "string" ? rec.plan : "—",
        status: typeof rec.status === "string" ? rec.status : "—",
        currentPeriodStart: typeof rec.currentPeriodStart === "string" ? rec.currentPeriodStart : null,
        currentPeriodEnd: typeof rec.currentPeriodEnd === "string" ? rec.currentPeriodEnd : null,
        activeUsers: typeof rec.activeUsers === "number" ? rec.activeUsers : null,
        currency: typeof rec.currency === "string" ? rec.currency : null,
      };
    },
  });
}

export default async function BillingSubscriptionsPage() {
  const { data: sub, source, status, errorMessage } = await getSubscription();

  const header = (
    <PageHeader
      title="Billing — Subscription"
      subtitle="This tenant's current billing subscription."
      back="/billing"
    />
  );

  // GAP-BILLING-SUBSCRIPTIONS-02: a transient/permission failure must not read
  // as "no subscription". A real 200+null is the empty state below.
  if (source === "error") {
    return (
      <div className="page-main wrap">
        {header}
        <LoadErrorState result={{ status, errorMessage }} area="subscription" backHref="/billing" />
      </div>
    );
  }

  if (!sub) {
    return (
      <div className="page-main wrap">
        {header}
        <EmptyState icon="📦" title="No subscription" message="This tenant does not have a billing subscription yet." />
      </div>
    );
  }

  return (
    <div className="page-main wrap">
      {header}

      <StatGrid>
        <StatCard icon="📊" label="Status" value={sub.status === "—" ? "—" : sub.status} />
        <StatCard icon="💱" label="Currency" value={sub.currency ?? "—"} />
      </StatGrid>

      <Card title="Subscription details" padding>
        <div className="fields">
          <div className="field"><span className="label">Subscription ID</span><span className="mono">{sub.id}</span></div>
          <div className="field">
            <span className="label">Plan</span>
            {/* GAP-BILLING-SUBSCRIPTIONS-03: link to the plan detail. */}
            <span><Link href={`/billing/plans/${sub.plan}`}>{sub.plan}</Link></span>
          </div>
          <div className="field">
            <span className="label">Status</span>
            <span>{sub.status === "—" ? "—" : <StatusPill status={sub.status} />}</span>
          </div>
          {/* The server returns null for period/usage until real billing data exists; never present an invented period as fact. */}
          <div className="field"><span className="label">Period start</span><span>{sub.currentPeriodStart ? formatIndianDate(sub.currentPeriodStart) : "—"}</span></div>
          <div className="field"><span className="label">Trial / period end</span><span>{sub.currentPeriodEnd ? formatIndianDate(sub.currentPeriodEnd) : "—"}</span></div>
          <div className="field"><span className="label">Active users</span><span>{sub.activeUsers ?? "—"}</span></div>
        </div>
      </Card>
    </div>
  );
}
