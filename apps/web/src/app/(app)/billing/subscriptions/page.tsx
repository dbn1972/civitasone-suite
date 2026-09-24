import { PageHeader } from "../../../_components/ds";
import { getBillingSubscriptions } from "../../../_data/loaders";
import { SubscriptionsTable } from "./SubscriptionsTable";

export default async function BillingSubscriptionsPage() {
  const { data, source } = await getBillingSubscriptions();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader title="Billing — Subscriptions" subtitle="Active and past subscriptions loaded from the Billing service." />
      {/* UX-012: the data-source badge now lives inside SubscriptionsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <SubscriptionsTable cacheKey="module.billing-subscriptions" rows={data} source={source === "error" ? "error" : "api"} />
    </div>
  );
}
