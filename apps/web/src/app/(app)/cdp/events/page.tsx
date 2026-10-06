import { PageHeader } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getCdpEventsPage } from "../_data";
import { CdpListTable } from "../_CdpListTable";

export const dynamic = "force-dynamic";

function parseOffset(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export default async function Page({ searchParams }: { searchParams?: { offset?: string } }) {
  const offset = parseOffset(searchParams?.offset);
  const { data, source } = await getCdpEventsPage(offset);

  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="CDP — Events"
        subtitle="Event taxonomy for interaction streams."
        back="/cdp"
        backLabel="Customer Data Platform"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <CdpListTable
        title="Event taxonomy"
        rows={data.rows}
        total={data.total}
        limit={data.limit}
        offset={offset}
        basePath="/cdp/events"
        filterPlaceholder="Filter events"
        columns={[
          { key: "label", label: "Event" },
          { key: "sublabel", label: "Category" },
          { key: "status", label: "Status" },
          { key: "meta", label: "Updated" },
        ]}
      />
    </div>
  );
}
