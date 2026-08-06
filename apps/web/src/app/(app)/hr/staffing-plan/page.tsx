import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

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

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/manpower/plans", [], {
    telemetryKey: "hr.staffing-plan",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function StaffingPlanPage() {
  const items = await getData();

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
      <div className="card" style={{ marginTop: 18 }}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…" pageSize={15} />
      </div>
    </main>
  );
}
