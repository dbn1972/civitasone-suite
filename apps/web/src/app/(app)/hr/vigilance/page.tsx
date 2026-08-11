import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  charges: string;
  filedDate: string;
  inquiryOfficer: string;
  nextHearing: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/vigilance", [], {
    telemetryKey: "hr.vigilance",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function VigilancePage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "id", label: "Case No." },
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "charges", label: "Charges" },
    { key: "inquiryOfficer", label: "Inquiry Officer" },
    { key: "nextHearing", label: "Next Hearing" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Vigilance & Disciplinary" subtitle="Vigilance cases and disciplinary proceedings." back="/hr" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <Card title="Vigilance Cases">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, department or inquiry officer…"
          pageSize={15}
          emptyIcon="⚖️"
          emptyTitle="No vigilance cases"
          emptyMessage="Vigilance and disciplinary cases appear here, registered by the Vigilance Department and tracked through inquiry, hearing, and disposal."
        />
      </Card>
    </main>
  );
}
