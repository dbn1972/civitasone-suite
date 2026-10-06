import { PageHeader } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getCdpSegmentList } from "../_data";
import { SegmentsTable } from "./SegmentsTable";

export const dynamic = "force-dynamic";

function parseOffset(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export default async function Page({ searchParams }: { searchParams?: { offset?: string } }) {
  const offset = parseOffset(searchParams?.offset);
  const { data, source } = await getCdpSegmentList(offset);

  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="CDP — Segments"
        // GAP-CDP-SEGMENTS-01 (decision): this route is read-only — no authoring
        // UI is wired here — so the copy and the hub tile both say "view".
        subtitle="View audience segments for campaigns."
        back="/cdp"
        backLabel="Customer Data Platform"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <SegmentsTable rows={data.rows} total={data.total} limit={data.limit} offset={offset} />
    </div>
  );
}
