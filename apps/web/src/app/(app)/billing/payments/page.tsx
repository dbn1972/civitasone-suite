import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getBillingPayments } from "../../../_data/loaders";

export default async function BillingPaymentsPage() {
  const { data, source } = await getBillingPayments();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <ModuleListPage
        title="Billing — Payments"
        description="Payment records loaded from the Billing service."
        rows={data}
        source={source}
      />
    </main>
  );
}
