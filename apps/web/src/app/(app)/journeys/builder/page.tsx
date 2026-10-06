import { PageHeader } from "../../../_components/ds";
import { getJourneyBuilder } from "../_data";
import { JourneyDefinitionsTable } from "../_components/JourneyTables";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getJourneyBuilder();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/journeys">Customer Journeys</a>
      </nav>
      <PageHeader title="Journeys — Definitions" subtitle="Journey definitions and their current status." />
      <JourneyDefinitionsTable rows={data} source={source} />
    </div>
  );
}
