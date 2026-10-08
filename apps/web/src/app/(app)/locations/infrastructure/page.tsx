import { PageHeader } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getLocationInfrastructureTyped } from "../_data";
import { InfrastructureTable } from "../_tables";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getLocationInfrastructureTyped();
  return (
    <div className="page-main">
      <PageHeader
        title="Locations — Infrastructure"
        subtitle="Infrastructure assets from location-service."
        back="/locations"
        backLabel="Locations"
      />
      <DataSourceBadge source={source === "error" ? "error" : "api"} />
      <InfrastructureTable rows={data} />
    </div>
  );
}
