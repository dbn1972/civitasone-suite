import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCatalogueBundles } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getCatalogueBundles();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/catalogue">Service Catalogue</a>
      </nav>
      <ModuleListPage
        title="Catalogue — Bundles"
        description="Product bundles and combo offerings."
        rows={data}
        source={source}
      />
    </main>
  );
}
