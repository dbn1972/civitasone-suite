import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getJourneyAnalytics } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getJourneyAnalytics();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/journeys">Customer Journeys</a>
      </nav>
      <ModuleListPage
        title="Journeys — Analytics"
        description="Execution outcomes for drop-off and conversion analysis."
        rows={data}
        source={source}
      />
    </div>
  );
}
