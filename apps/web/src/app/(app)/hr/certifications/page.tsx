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
  expiryDate: string | null;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/certifications", [], {
    telemetryKey: "hr.certifications",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function CertificationsPage() {
  const { data: items, source } = await getData();

  const valid = items.filter((i) => i.status === "valid" || !i.expiryDate).length;
  const external = items.filter((i) => i.issuingBody && i.issuingBody !== "Internal").length;
  const depts = new Set(items.map((i) => i.department)).size;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "certification", label: "Certification / Course" },
    { key: "issuingBody", label: "Issuing Body" },
    { key: "issuedDate", label: "Issued On" },
    { key: "expiryDate", label: "Expires" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Certifications"
        subtitle="Employee professional certifications, training completions, and validity tracking."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏅" iconBg="#e6f0ff" label="Total Certificates" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Valid" value={valid} />
        <StatCard icon="🌐" iconBg="#fffbe6" label="External Body" value={external} />
        <StatCard icon="🏢" iconBg="#f5f5f5" label="Departments" value={depts} />
      </StatGrid>
      <Card title="Certifications Register">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee, certification or issuing body…"
          pageSize={15}
          emptyIcon="🏅"
          emptyTitle="No certifications recorded yet"
          emptyMessage="Certifications appear here once employees complete external courses, government training programmes, or skill assessments with a certificate reference."
        />
      </Card>
    </main>
  );
}
