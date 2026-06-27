import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getBillingPlans } from "../../../_data/loaders";

export default async function BillingPlansPage() {
  const { data, source } = await getBillingPlans();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <ModuleListPage
        title="Billing — Plans"
        description="All billing plans. Create new plans or view details."
        rows={data}
        source={source}
      >
        <a href="/billing/plans/new" className="btn primary" style={{ minHeight: 44 }}>
          + New Plan
        </a>
      </ModuleListPage>
    </main>
  );
}
