import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getJourneyBuilder } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getJourneyBuilder();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/journeys">Customer Journeys</a>
      </nav>
      <ModuleListPage
        title="Journeys — Builder"
        description="Journey definitions for design and activation."
        rows={data}
        source={source}
      />
    </main>
  );
}
