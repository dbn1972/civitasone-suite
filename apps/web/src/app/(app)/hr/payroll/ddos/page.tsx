import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CreateDdoForm } from "./CreateDdoForm";

type DdoRow = {
  ddoCode: string;
  name: string;
  departmentIds: string[];
} & Record<string, unknown>;

async function getDdos(): Promise<LoaderResult<DdoRow[]>> {
  return fetchJson<unknown, DdoRow[]>("/api/v1/payroll/ddos", [], {
    telemetryKey: "payroll.ddos",
    mapResponse: (p) => (Array.isArray(p) ? (p as DdoRow[]) : null),
  });
}

export default async function DdosPage() {
  const { data: ddos, source } = await getDdos();

  const rows = ddos.map((d) => ({ ...d, departmentCount: d.departmentIds?.length ?? 0 }));
  const multiDeptDdos = ddos.filter((d) => (d.departmentIds?.length ?? 0) > 1).length;
  const totalDeptMappings = ddos.reduce((s, d) => s + (d.departmentIds?.length ?? 0), 0);
  const avgDepts = ddos.length > 0 ? (totalDeptMappings / ddos.length).toFixed(1) : "0";

  const columns: { key: (keyof DdoRow & string) | "departmentCount"; label: string; align?: "left" | "right" }[] = [
    { key: "ddoCode", label: "DDO Code" },
    { key: "name", label: "Name" },
    { key: "departmentCount", label: "Departments", align: "right" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="DDO Management"
        subtitle="Drawing & Disbursing Officer (DDO) master data and department mapping for multi-DDO payroll."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🏛️" iconBg="#e6f0ff" label="Total DDOs" value={ddos.length} />
        <StatCard icon="🏢" iconBg="#e6f7f0" label="Multi-Dept DDOs" value={multiDeptDdos} />
        <StatCard icon="🔗" iconBg="#fff7e6" label="Total Dept Mappings" value={totalDeptMappings} />
        <StatCard icon="📊" iconBg="#f0fff4" label="Avg Depts / DDO" value={avgDepts} />
      </StatGrid>

      <CreateDdoForm />

      <Card title="DDOs">
        <DataTable<DdoRow & { departmentCount: number }>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by DDO code or name…"
          pageSize={15}
          emptyIcon="🏛️"
          emptyTitle="No DDOs configured yet"
          emptyMessage="Create your first DDO using the form above."
        />
      </Card>
    </main>
  );
}
