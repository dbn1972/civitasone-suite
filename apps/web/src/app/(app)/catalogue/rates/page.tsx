import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCatalogueRates } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getCatalogueRates();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/catalogue">Service Catalogue</a>
      </nav>
      <ModuleListPage
        title="Catalogue — Rates"
        description="Effective-dated rate cards."
        rows={data}
        source={source}
      />
    </main>
  );
}
