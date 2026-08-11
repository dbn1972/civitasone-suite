import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  certification: string;
  issuingBody: string;
  issuedDate: string;
  expiryDate: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/certifications", [], {
    telemetryKey: "hr.certifications",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function CertificationsPage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "certification", label: "Certification" },
    { key: "issuingBody", label: "Issuing Body" },
    { key: "issuedDate", label: "Issued" },
    { key: "expiryDate", label: "Expiry" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Certifications" subtitle="Employee professional certifications and validity tracking." back="/hr" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <Card title="Certifications">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or certification…"
          pageSize={15}
          emptyIcon="🏅"
          emptyTitle="No certifications yet"
          emptyMessage="Professional certifications appear here once employees complete external courses or government training programmes."
        />
      </Card>
    </main>
  );
}
