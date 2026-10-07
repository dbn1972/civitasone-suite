import { PageHeader } from "../../../_components/ds";
import { getJourneyTemplates } from "../_data";
import { JourneyTriggersTable } from "../_components/JourneyTables";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getJourneyTemplates();
  return (
    <div className="page-main">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/journeys">Customer Journeys</a>
      </nav>
      <PageHeader title="Journeys — Triggers" subtitle="Trigger rules that enroll profiles into journeys." />
      <JourneyTriggersTable rows={data} source={source} />
    </div>
  );
}
