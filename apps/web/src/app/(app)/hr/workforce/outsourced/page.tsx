import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/**
 * OutsourcedPage — outsourced staff per agency, service category, deployment location.
 * GFR 2017 Chapter 8: outsourced service contract management.
 */

type ApiEmployee = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  agency?: string;
  department?: string;
  service?: string;
  serviceCategory?: string;
  deploymentLocation?: string;
  location?: string;
  headcount?: number | string;
  contractValue?: string;
  contractEnd?: string;
  employmentType?: string;
  type?: string;
  status: string;
};

type Row = {
  id: string;
  vendor: string;
  department: string;
  service: string;
  deploymentLocation: string;
  headcount: string;
  contractEnd: string;
  status: string;
} & Record<string, unknown>;

function mapOutsourced(apiItems: ApiEmployee[]): Row[] {
  return apiItems
    .filter((e) => {
      const t = (e.employmentType ?? e.type ?? "").toLowerCase();
      return t === "outsourced" || t === "vendor" || t === "third_party";
    })
    .map((e) => ({
      id: e.id,
      vendor: e.agency ?? "—",
      department: e.department ?? "—",
      service: e.service ?? e.serviceCategory ?? "—",
      deploymentLocation: e.deploymentLocation ?? e.location ?? "—",
      headcount: String(e.headcount ?? "1"),
      contractEnd: e.contractEnd ?? "—",
      status: e.status,
    }));
}

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=200", [], {
    telemetryKey: "hr.workforce.outsourced",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiEmployee[] })?.data;
      return Array.isArray(arr) ? mapOutsourced(arr as ApiEmployee[]) : null;
    },
  });
}

const COLUMNS: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
  { key: "vendor", label: "Vendor / Agency" },
  { key: "department", label: "Department" },
  { key: "service", label: "Service Category" },
  { key: "deploymentLocation", label: "Location" },
  { key: "headcount", label: "Headcount", align: "right" },
  { key: "contractEnd", label: "Contract End" },
  { key: "status", label: "Status", cellType: "status" },
];

export default async function OutsourcedPage() {
  const { data: items, source } = await getData();

  const vendors = new Set(items.map((i) => i.vendor).filter((v) => v !== "—")).size;
  const active = items.filter((i) => i.status?.toLowerCase() === "active").length;
  const totalHeadcount = items.reduce((s, i) => s + (Number(i.headcount) || 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Outsourced Workforce"
        subtitle="Vendor-wise outsourced staff, service categories, and deployment locations. GFR 2017 Ch. 8."
        back="/hr/workforce"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏭" iconBg="#e6f0ff" label="Vendors" value={vendors} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active Contracts" value={active} />
        <StatCard icon="👷" iconBg="#fffbe6" label="Total Headcount" value={totalHeadcount} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Total Records" value={items.length} />
      </StatGrid>
      <Card title="Outsourced Workforce">
        <DataTable<Row>
          columns={COLUMNS}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by vendor, department or service…"
          pageSize={15}
          emptyIcon="🏢"
          emptyTitle="No outsourced staff records"
          emptyMessage="Outsourced workforce records appear here, tracking vendor-supplied staff per GFR 2017 Chapter 8 contractor management requirements."
        />
      </Card>
    </main>
  );
}
