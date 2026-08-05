import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, DataTable, EmptyState, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmControlTower } from "../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { ExceptionTable } from "./ExceptionTable";
import { hotExceptions, rankRegions, totalExceptionCount } from "./tower";

export const dynamic = "force-dynamic";

type RegionRow = { id: string; region: string; deals: number; pipelineMinor: string };

export default async function ControlTowerPage() {
  const { data, source } = await getCrmControlTower();

  if (!data) {
    return (
      <>
        <PageHeader title="Control Tower" back="/crm" backLabel="CRM" />
        {source === "error" && <DataSourceBadge source={source} />}
        <EmptyState icon="🛰️" title="Control tower unavailable" message="The executive GIS and exception feed could not be loaded." />
      </>
    );
  }

  const regions = rankRegions(data.regions);
  const exceptions = hotExceptions(data.exceptions);

  const regionRows: RegionRow[] = regions.map((r) => ({
    id: r.region,
    region: r.region,
    deals: r.dealCount,
    pipelineMinor: r.pipelineMinor,
  }));

  const exRows = exceptions.map((e) => ({
    id: e.id,
    label: e.label,
    severity: e.severity,
    count: e.count,
    href: e.href,
  }));

  return (
    <>
      <PageHeader
        title="Executive Control Tower"
        subtitle="Regional pipeline heat, exception counts, and drill-downs into the operational dashboards."
        back="/crm"
        backLabel="CRM"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🗺️" iconBg="#e0f2fe" label="Regions" value={regions.length.toLocaleString("en-IN")} />
        <StatCard icon="🚨" iconBg="#fee2e2" label="Exception volume" value={totalExceptionCount(exceptions).toLocaleString("en-IN")} />
      </StatGrid>

      <Card title="GIS — pipeline by region">
        <DataTable<RegionRow>
          columns={[
            { key: "region", label: "Region" },
            { key: "deals", label: "Active deals", align: "right" },
            { key: "pipelineMinor", label: "Pipeline", align: "right", cellType: "amount" },
          ]}
          rows={regionRows}
          sortable
          exportable
          exportFilename="control-tower-regions"
          emptyIcon="🗺️"
          emptyTitle="No regional pipeline"
          emptyMessage="Open deals with a contact region appear on the heat map."
        />
      </Card>

      <Card title="Exceptions">
        <ExceptionTable rows={exRows} />
      </Card>
    </>
  );
}
