import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getLoyaltyTiers } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getLoyaltyTiers();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/loyalty">Loyalty Programs</a>
      </nav>
      <ModuleListPage
        title="Loyalty — Tiers"
        description="Tier definitions via programme configuration."
        rows={data}
        source={source}
      />
    </main>
  );
}
