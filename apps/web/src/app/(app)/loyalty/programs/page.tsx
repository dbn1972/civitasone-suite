import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getLoyaltyPrograms } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getLoyaltyPrograms();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/loyalty">Loyalty Programs</a>
      </nav>
      <ModuleListPage
        title="Loyalty — Programs"
        description="Loyalty programmes from loyalty-service."
        rows={data}
        source={source}
      />
    </main>
  );
}
