import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getJourneyActive } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getJourneyActive();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/journeys">Customer Journeys</a>
      </nav>
      <ModuleListPage
        title="Journeys — Active"
        description="Running journey executions and enrolments."
        rows={data}
        source={source}
      />
    </div>
  );
}
