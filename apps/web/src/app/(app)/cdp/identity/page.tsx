import { PageHeader } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getCdpIdentityPage } from "../_data";
import { CdpListTable } from "../_CdpListTable";

export const dynamic = "force-dynamic";

function parseOffset(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export default async function Page({ searchParams }: { searchParams?: { offset?: string } }) {
  const offset = parseOffset(searchParams?.offset);
  const { data, source } = await getCdpIdentityPage(offset);

  return (
    <div className="page-main">
      <PageHeader
        title="CDP — Identity Graph"
        // GAP-CDP-IDENTITY-02 (decision): this list is view-only — there is no
        // resolve/stitch action wired from here — so the copy says so rather
        // than implying a resolution step the page does not offer.
        subtitle="Anonymous visitors not yet linked to a profile (view only)."
        back="/cdp"
        backLabel="Customer Data Platform"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <CdpListTable
        title="Anonymous visitors"
        rows={data.rows}
        total={data.total}
        limit={data.limit}
        offset={offset}
        basePath="/cdp/identity"
        filterPlaceholder="Filter visitors"
        // GAP-CDP-IDENTITY-02: no raw-id column; the visitor's own short
        // visitorRef is the label, with device/status and last-seen alongside.
        columns={[
          { key: "label", label: "Visitor" },
          { key: "sublabel", label: "Device" },
          { key: "status", label: "Status" },
          { key: "meta", label: "Last seen" },
        ]}
      />
    </div>
  );
}
