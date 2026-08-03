import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getRecMatrix } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getRecMatrix();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/recommendations">Recommendations</a>
      </nav>
      <ModuleListPage
        title="Recommendations — Cross-Sell Matrix"
        description="Product affinity rules and cross-sell configuration."
        rows={data}
        source={source}
      />
    </main>
  );
}
