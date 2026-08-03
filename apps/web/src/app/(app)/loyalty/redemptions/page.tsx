import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getLoyaltyRedemptions } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getLoyaltyRedemptions();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/loyalty">Loyalty Programs</a>
      </nav>
      <ModuleListPage
        title="Loyalty — Redemptions"
        description="Point redemption history."
        rows={data}
        source={source}
      />
    </main>
  );
}
