import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getJourneyActive } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getJourneyActive();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/journeys">Customer Journeys</a>
      </nav>
      <ModuleListPage
        title="Journeys — Active"
        description="Running journey executions and enrolments."
        rows={data}
        source={source}
      />
    </main>
  );
}
