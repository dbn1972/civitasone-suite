import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getBillingInvoices } from "../../../_data/loaders";

export default async function BillingInvoicesPage() {
  const { data, source } = await getBillingInvoices();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <ModuleListPage
        title="Billing — Invoices"
        description="Generated invoices loaded from the Billing service."
        rows={data}
        source={source}
      />
    </main>
  );
}
