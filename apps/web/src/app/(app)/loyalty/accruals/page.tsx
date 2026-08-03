import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getLoyaltyAccruals } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getLoyaltyAccruals();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/loyalty">Loyalty Programs</a>
      </nav>
      <ModuleListPage
        title="Loyalty — Accruals"
        description="Enrolments for accrual/balance drill-down."
        rows={data}
        source={source}
      />
    </main>
  );
}
