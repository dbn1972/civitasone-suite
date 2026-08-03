import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getRecHealth } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getRecHealth();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/recommendations">Recommendations</a>
      </nav>
      <ModuleListPage
        title="Recommendations — Health Scores"
        description="At-risk accounts for churn intervention."
        rows={data}
        source={source}
      />
    </main>
  );
}
