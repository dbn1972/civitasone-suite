import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  department: string;
  sanctionedPosts: string;
  filled: string;
  vacant: string;
  fillPercentage: string;
  lastReview: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/staffing-plan", [], {
    telemetryKey: "hr.staffing-plan",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function StaffingPlanPage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "department", label: "Department" },
    { key: "sanctionedPosts", label: "Sanctioned", align: "right" },
    { key: "filled", label: "Filled", align: "right" },
    { key: "vacant", label: "Vacant", align: "right" },
    { key: "fillPercentage", label: "Fill %" },
    { key: "lastReview", label: "Last Review" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Staffing Plan" subtitle="Department-wise sanctioned posts, filled positions, and vacancies." back="/hr" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <Card title="Staffing Plan">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by department, grade or location…"
          pageSize={15}
          emptyIcon="📊"
          emptyTitle="No staffing plan entries"
          emptyMessage="Sanctioned post vs filled position data appears here for workforce planning and vacancy management."
        />
      </Card>
    </main>
  );
}
