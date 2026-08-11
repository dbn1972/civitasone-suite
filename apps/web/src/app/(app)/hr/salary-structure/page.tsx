import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type ApiStructure = {
  id: string;
  name: string;
  grade?: string;
  components?: string;
  basicPayRange?: string;
  effectiveDate?: string;
  employeeCount?: number;
  status: string;
};

type Row = {
  id: string;
  name: string;
  grade: string;
  components: string;
  basicPay: string;
  effectiveDate: string;
  employees: string;
  status: string;
} & Record<string, unknown>;

function mapStructures(apiItems: ApiStructure[]): Row[] {
  return apiItems.map((s) => ({
    id: s.id,
    name: s.name,
    grade: s.grade ?? "—",
    components: s.components ?? "—",
    basicPay: s.basicPayRange ?? "—",
    effectiveDate: s.effectiveDate ?? "—",
    employees: s.employeeCount != null ? String(s.employeeCount) : "—",
    status: s.status,
  }));
}

async function getStructures(): Promise<LoaderResult<Row[]>> {
  const res = await fetchJson<unknown, Row[]>("/api/v1/payroll/structures", [], {
    telemetryKey: "hr.salary-structures",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiStructure[] })?.data;
      return Array.isArray(arr) ? mapStructures(arr as ApiStructure[]) : null;
    },
  });
  return res;
}

export default async function SalaryStructurePage() {
  const { data: items, source } = await getStructures();

  const active = items.filter((i) => i.status === "active").length;
  const totalEmployees = items.reduce((sum, i) => {
    const n = parseInt(i.employees);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "name", label: "Structure Name" },
    { key: "grade", label: "Grade/Level" },
    { key: "components", label: "Components" },
    { key: "basicPay", label: "Basic Pay Range" },
    { key: "effectiveDate", label: "Effective Date" },
    { key: "employees", label: "Employees" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Salary Structures" subtitle="Pay structure definitions by grade and level." back="/hr" />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e6f0ff" label="Structures" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="👥" iconBg="#fffbe6" label="Employees Covered" value={totalEmployees.toLocaleString("en-IN")} />
        <StatCard icon="📅" iconBg="#f5f5f5" label="Last Revision" value="Jan 2024" />
      </StatGrid>
      <Card title="Salary Structures">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by name, grade or status…"
          pageSize={15}
          emptyIcon="💼"
          emptyTitle="No salary structures"
          emptyMessage="Pay structure definitions by grade and level appear here. Structures define the component breakdown for each employee category."
        />
      </Card>
    </main>
  );
}
