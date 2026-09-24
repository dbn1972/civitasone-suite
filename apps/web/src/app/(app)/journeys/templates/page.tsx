import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getJourneyTemplates } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getJourneyTemplates();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/journeys">Customer Journeys</a>
      </nav>
      <ModuleListPage
        title="Journeys — Templates"
        description="Reusable trigger rules used as journey templates."
        rows={data}
        source={source}
      />
    </div>
  );
}
