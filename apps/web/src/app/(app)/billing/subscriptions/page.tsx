import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getBillingSubscriptions } from "../../../_data/loaders";

export default async function BillingSubscriptionsPage() {
  const { data, source } = await getBillingSubscriptions();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <ModuleListPage
        title="Billing — Subscriptions"
        description="Active and past subscriptions loaded from the Billing service."
        rows={data}
        source={source}
      />
    </main>
  );
}
