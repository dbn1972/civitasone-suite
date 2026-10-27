import Link from "next/link";
import { PageHeader, Card, StatCard, StatGrid, EmptyState, StatusPill, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { SubscriptionHistoryTable, type SubscriptionHistoryRow } from "./SubscriptionHistoryTable";

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
  // GAP-BILLING-SUBSCRIPTIONS-03 (UAT B4): plan name, start, renewal and plan price in paise.
  planName: string | null;
  startDate: string | null;
  renewalDate: string | null;
  amountMinor: string | null;
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
        planName: typeof rec.planName === "string" ? rec.planName : null,
        startDate: typeof rec.startDate === "string" ? rec.startDate : null,
        renewalDate: typeof rec.renewalDate === "string" ? rec.renewalDate : null,
        amountMinor: typeof rec.amountMinor === "string" && /^\d+$/.test(rec.amountMinor) ? rec.amountMinor : null,
      };
    },
  });
}

// GAP-BILLING-SUBSCRIPTIONS-03: the tenant's own subscription history (active and past). A payload
// that is not a { data: [] } list is a failure (null), never an empty history.
async function getHistory(): Promise<LoaderResult<SubscriptionHistoryRow[] | null>> {
  return fetchJson<unknown, SubscriptionHistoryRow[] | null>("/api/v1/billing/subscriptions/history", null, {
    telemetryKey: "billing.subscription-history",
    mapResponse: (p) => {
      const list = p && typeof p === "object" ? (p as { data?: unknown }).data : undefined;
      if (!Array.isArray(list)) return null;
      const rows: SubscriptionHistoryRow[] = [];
      for (const raw of list) {
        if (!raw || typeof raw !== "object") continue;
        const rec = raw as Record<string, unknown>;
        if (typeof rec.id !== "string") continue;
        rows.push({
          id: rec.id,
          plan: typeof rec.plan === "string" ? rec.plan : "",
          planName: typeof rec.planName === "string" ? rec.planName : null,
          status: typeof rec.status === "string" ? rec.status : "—",
          startDate: typeof rec.startDate === "string" ? rec.startDate : null,
          renewalDate: typeof rec.renewalDate === "string" ? rec.renewalDate : null,
          amountMinor: typeof rec.amountMinor === "string" && /^\d+$/.test(rec.amountMinor) ? rec.amountMinor : null,
          currency: typeof rec.currency === "string" ? rec.currency : null,
        });
      }
      return rows;
    },
  });
}

export default async function BillingSubscriptionsPage() {
  const [{ data: sub, source, status, errorMessage }, history] = await Promise.all([getSubscription(), getHistory()]);

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
            <span><Link href={`/billing/plans/${sub.plan}`}>{sub.planName ?? sub.plan}</Link></span>
          </div>
          <div className="field">
            <span className="label">Status</span>
            <span>{sub.status === "—" ? "—" : <StatusPill status={sub.status} />}</span>
          </div>
          {/* The server returns null for period/usage until real billing data exists; never present an invented period as fact. */}
          <div className="field"><span className="label">Subscription start</span><span>{sub.startDate ? formatIndianDate(sub.startDate) : "—"}</span></div>
          <div className="field"><span className="label">Renewal date</span><span>{sub.renewalDate ? formatIndianDate(sub.renewalDate) : "—"}</span></div>
          <div className="field"><span className="label">Plan price</span><span>{sub.amountMinor !== null ? formatMoney(sub.amountMinor) : "—"}</span></div>
          <div className="field"><span className="label">Period start</span><span>{sub.currentPeriodStart ? formatIndianDate(sub.currentPeriodStart) : "—"}</span></div>
          <div className="field"><span className="label">Trial / period end</span><span>{sub.currentPeriodEnd ? formatIndianDate(sub.currentPeriodEnd) : "—"}</span></div>
          <div className="field"><span className="label">Active users</span><span>{sub.activeUsers ?? "—"}</span></div>
        </div>
      </Card>

      <Card title="Subscription history" padding>
        {history.source === "error" || history.data === null ? (
          <LoadErrorState result={{ status: history.status, errorMessage: history.errorMessage }} area="subscription history" backHref="/billing" />
        ) : (
          <SubscriptionHistoryTable rows={history.data} />
        )}
      </Card>
    </div>
  );
}
