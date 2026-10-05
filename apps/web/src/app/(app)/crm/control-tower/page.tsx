import { Card, DataTable, EmptyState, PageHeader, RefreshErrorState, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmControlTower } from "../../../_data/loaders";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";
import { ExceptionTable } from "./ExceptionTable";
import { hotExceptions, rankRegions, totalExceptionCount } from "./tower";

export const dynamic = "force-dynamic";

type RegionRow = { id: string; region: string; deals: number; pipelineMinor: string };

export default async function ControlTowerPage() {
  const t = await getTranslations("crmControlTowerPage");
  const { data, source } = await getCrmControlTower();

  // GAP-CRM-CONTROL-TOWER-03: a feed failure must offer a real retry and keep
  // the page's identity, not collapse to a dead "unavailable" EmptyState with
  // no action. Only a genuine (successful) null uses the EmptyState below.
  if (source === "error") {
    return (
      <>
        <PageHeader title={t("title")} back="/crm" backLabel={t("backLabel")} />
        <RefreshErrorState error={toHumanError("load", { area: t("loadArea") })} backHref="/crm" />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title={t("title")} back="/crm" backLabel={t("backLabel")} />
        <EmptyState
          icon="🛰️"
          title={t("unavailableTitle")}
          message={t("unavailableMessage")}
        />
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
        subtitle={t("subtitle")}
        back="/crm"
        backLabel="CRM"
      />
      <StatGrid>
        <StatCard icon="🗺️" iconBg="#e0f2fe" label="Regions" value={regions.length.toLocaleString("en-IN")} />
        {/*
          GAP-CRM-CONTROL-TOWER-05: this is the sum of each exception
          category's count, not a distinct record count — one account can be
          dormant AND overdue and be counted in both. Label it as a count of
          items and spell the overlap out in the hint so it is not read as a
          number of unique records.
        */}
        <StatCard
          icon="🚨"
          iconBg="#fee2e2"
          label="Open exception items"
          hint="Total across all exception categories. An account can appear in more than one category, so this is not a count of unique records."
          value={totalExceptionCount(exceptions).toLocaleString("en-IN")}
        />
      </StatGrid>

      <Card title={t("pipelineByRegion")}>
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
          emptyMessage={t("regionEmptyMessage")}
        />
      </Card>

      <Card title="Exceptions">
        <ExceptionTable rows={exRows} />
      </Card>
    </>
  );
}
