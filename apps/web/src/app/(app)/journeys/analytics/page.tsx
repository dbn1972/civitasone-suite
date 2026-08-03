import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getJourneyAnalytics } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getJourneyAnalytics();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/journeys">Customer Journeys</a>
      </nav>
      <ModuleListPage
        title="Journeys — Analytics"
        description="Execution outcomes for drop-off and conversion analysis."
        rows={data}
        source={source}
      />
    </main>
  );
}
