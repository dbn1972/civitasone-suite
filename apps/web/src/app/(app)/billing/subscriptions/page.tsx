import { PageHeader } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getBillingSubscriptions } from "../../../_data/loaders";
import { SubscriptionsTable } from "./SubscriptionsTable";

export default async function BillingSubscriptionsPage() {
  const { data, source } = await getBillingSubscriptions();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader title="Billing — Subscriptions" subtitle="Active and past subscriptions loaded from the Billing service." />
      {source === "error" ? <DataSourceBadge source={source} /> : null}
      <SubscriptionsTable cacheKey="module.billing-subscriptions" rows={data} source={source === "error" ? "error" : "api"} />
    </main>
  );
}
