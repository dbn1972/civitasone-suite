import { PageHeader } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getLocationJurisdictionsTyped } from "../_data";
import { JurisdictionsTable } from "../_tables";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getLocationJurisdictionsTyped();
  return (
    <div className="page-main">
      <PageHeader
        title="Locations — Jurisdictions"
        subtitle="Jurisdiction records from location-service."
        back="/locations"
        backLabel="Locations"
      />
      <DataSourceBadge source={source === "error" ? "error" : "api"} />
      <JurisdictionsTable rows={data} />
    </div>
  );
}
