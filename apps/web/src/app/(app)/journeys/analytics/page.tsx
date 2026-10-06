import { PageHeader } from "../../../_components/ds";
import { getJourneyAnalytics } from "../_data";
import { AnalyticsView } from "../_components/AnalyticsView";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getJourneyAnalytics();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/journeys">Customer Journeys</a>
      </nav>
      <PageHeader title="Journeys — Analytics" subtitle="Execution outcomes: completion and drop-off counts." />
      <AnalyticsView analytics={data} source={source} />
    </div>
  );
}
