import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type RawRow = {
  id: string;
  complainantId: string;
  respondentId?: string;
  summary: string;
  filedAt: string;
  status: string;
  confidential: boolean;
} & Record<string, unknown>;

type Row = RawRow & { caseRef: string };

async function getData(): Promise<LoaderResult<RawRow[]>> {
  return fetchJson<unknown, RawRow[]>("/api/v1/hrms/icc/complaints", [], {
    telemetryKey: "hr.icc",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RawRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function IccPage() {
  const { data: rawItems, source } = await getData();
  const items: Row[] = rawItems.map((r) => ({ ...r, caseRef: "ICC/" + r.id.slice(0, 8).toUpperCase() }));

  const filed = items.filter((i) => i.status === "filed").length;
  const inquiry = items.filter((i) => i.status === "inquiry" || i.status === "under_inquiry").length;
  const closed = items.filter((i) => ["closed", "disposed", "withdrawn"].includes(i.status)).length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "caseRef", label: "Case Ref" },
    { key: "summary", label: "Summary" },
    { key: "filedAt", label: "Filed Date" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="ICC Complaints"
        subtitle="Internal Complaints Committee — sexual harassment complaints under the POSH Act, 2013."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="⚖️" iconBg="#e6f0ff" label="Total Complaints" value={items.length} />
        <StatCard icon="🔔" iconBg="#fffbe6" label="Filed" value={filed} />
        <StatCard icon="🔍" iconBg="#fff1f0" label="Under Inquiry" value={inquiry} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Disposed" value={closed} />
      </StatGrid>
      <Card title="ICC Complaint Register">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by reference or status…"
          pageSize={15}
          emptyIcon="⚖️"
          emptyTitle="No ICC complaints on record"
          emptyMessage="Complaints under the Prevention of Sexual Harassment (POSH) Act are handled by the Internal Complaints Committee (ICC) with full confidentiality."
        />
      </Card>
    </main>
  );
}
