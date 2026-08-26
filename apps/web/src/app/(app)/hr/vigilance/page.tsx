import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type RawRow = {
  id: string;
  employee: string;
  department: string;
  charges: string;
  filedDate: string;
  inquiryOfficer: string;
  nextHearing: string;
  status: string;
} & Record<string, unknown>;

type Row = RawRow & { caseRef: string };

async function getData(): Promise<LoaderResult<RawRow[]>> {
  return fetchJson<unknown, RawRow[]>("/api/v1/hrms/vigilance", [], {
    telemetryKey: "hr.vigilance",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RawRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

function shortId(id: string): string {
  return "VIG/" + id.slice(0, 8).toUpperCase();
}

export default async function VigilancePage() {
  const { data: rawItems, source } = await getData();
  const items: Row[] = rawItems.map((r) => ({ ...r, caseRef: shortId(r.id) }));

  const opened = items.filter((i) => i.status === "opened").length;
  const inquiry = items.filter((i) => i.status === "inquiry" || i.status === "under_inquiry").length;
  const closed = items.filter((i) => ["closed", "disposed", "finalised"].includes(i.status)).length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "caseRef", label: "Case Ref" },
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "charges", label: "Charge Summary" },
    { key: "inquiryOfficer", label: "Inquiry Officer" },
    // Backend aliases inquiry_appointed_date (a one-time event) as
    // "nextHearing" -- it is not a recurring hearing schedule, so a case
    // shows the same date forever after its inquiry officer is appointed,
    // regardless of how many hearings actually happen afterward. Labelled
    // honestly until the backend tracks real hearing dates.
    { key: "nextHearing", label: "Inquiry Officer Appointed" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Vigilance & Disciplinary"
        subtitle="Major proceedings under CCS (CCA) Rules — charge memos, inquiry, penalty and appeal."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
        <StatCard icon="⚖️" iconBg="#e6f0ff" label="Total Cases" value={items.length} />
        <StatCard icon="🔴" iconBg="#fff1f0" label="Charge Memo Stage" value={opened} />
        <StatCard icon="🔍" iconBg="#fffbe6" label="Under Inquiry" value={inquiry} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Disposed / Closed" value={closed} />
      </StatGrid>
      <Card title="Vigilance Cases Register">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee, department or inquiry officer…"
          pageSize={15}
          emptyIcon="⚖️"
          emptyTitle="No vigilance cases on record"
          emptyMessage="Major departmental proceedings appear here — registered by the Vigilance Unit with charge memos, inquiry officer appointment, and penalty tracking under CCS (CCA) Rules."
        />
      </Card>
    </main>
  );
}
