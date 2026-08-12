import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  vendor: string;
  department: string;
  headcount: string;
  service: string;
  contractValue: string;
  contractEnd: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=50", [], {
    telemetryKey: "hr.employees_limit_50",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function OutsourcedPage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "vendor", label: "Vendor" },
    { key: "department", label: "Department" },
    { key: "headcount", label: "Headcount", align: "right" },
    { key: "service", label: "Service" },
    { key: "contractValue", label: "Contract Value" },
    { key: "contractEnd", label: "Contract End" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  const uniqueVendors = new Set(items.map((i) => i.vendor).filter(Boolean)).size;
  const activeContracts = items.filter((i) => String(i.status).toLowerCase() === "active").length;
  const totalHeadcount = items.reduce((s, i) => s + Number(i.headcount || 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Outsourced Workforce" subtitle="Vendor-wise outsourced staff, headcount, and contract details." back="/hr" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total Records" value={items.length} />
        <StatCard icon="🏭" iconBg="#f0fff4" label="Unique Vendors" value={uniqueVendors} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active Contracts" value={activeContracts} />
        <StatCard icon="👷" iconBg="#fff7e6" label="Total Headcount" value={totalHeadcount} />
      </StatGrid>
      <Card title="Outsourced Workforce">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…"
          pageSize={15}
          emptyIcon="🏢"
          emptyTitle="No outsourced staff"
          emptyMessage="Outsourced workforce records appear here, tracking vendor-supplied staff and their contract details."
        />
      </Card>
    </main>
  );
}
