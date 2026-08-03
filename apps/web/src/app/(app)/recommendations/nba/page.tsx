import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getRecNba } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getRecNba();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/recommendations">Recommendations</a>
      </nav>
      <ModuleListPage
        title="Recommendations — Next Best Action"
        description="Predictive / NBA signals from recommendation-service."
        rows={data}
        source={source}
      />
    </main>
  );
}
