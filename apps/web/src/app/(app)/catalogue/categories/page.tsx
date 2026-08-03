import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCatalogueCategories } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getCatalogueCategories();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/catalogue">Service Catalogue</a>
      </nav>
      <ModuleListPage
        title="Catalogue — Categories"
        description="Hierarchical product category tree."
        rows={data}
        source={source}
      />
    </main>
  );
}
