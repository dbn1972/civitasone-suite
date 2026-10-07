import { PageHeader } from "../../../_components/ds";
import { getJourneyActive } from "../_data";
import { ActiveJourneysTable } from "../_components/JourneyTables";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getJourneyActive();
  return (
    <div className="page-main">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/journeys">Customer Journeys</a>
      </nav>
      <PageHeader title="Journeys — Active" subtitle="Running journey executions and enrolments." />
      <ActiveJourneysTable rows={data} source={source} />
    </div>
  );
}
