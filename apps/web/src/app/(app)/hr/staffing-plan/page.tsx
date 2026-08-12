import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  department: string;
  cadre: string;
  sanctionedPosts: number;
  filled: number;
  vacant: number;
  fillPercentage: number;
  lastReview: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/staffing-plan", [], {
    telemetryKey: "hr.staffing-plan",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function StaffingPlanPage() {
  const { data: items, source } = await getData();

  const totalSanctioned = items.reduce((s, i) => s + Number(i.sanctionedPosts ?? 0), 0);
  const totalFilled = items.reduce((s, i) => s + Number(i.filled ?? 0), 0);
  const totalVacant = items.reduce((s, i) => s + Number(i.vacant ?? 0), 0);
  const overallFill = totalSanctioned > 0 ? Math.round((totalFilled / totalSanctioned) * 100) : 0;

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "department", label: "Department / Cadre" },
    { key: "sanctionedPosts", label: "Sanctioned", align: "right" },
    { key: "filled", label: "Filled", align: "right" },
    { key: "vacant", label: "Vacant", align: "right" },
    { key: "fillPercentage", label: "Fill %" },
    { key: "lastReview", label: "Last Review" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Staffing Plan"
        subtitle="Department-wise sanctioned strength, filled positions, and vacancy analysis."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e6f0ff" label="Sanctioned Posts" value={totalSanctioned} />
        <StatCard icon="👥" iconBg="#e6f7f0" label="Filled" value={totalFilled} />
        <StatCard icon="⬜" iconBg="#fff1f0" label="Vacant" value={totalVacant} />
        <StatCard icon="📈" iconBg="#fffbe6" label="Fill Rate %" value={overallFill} />
      </StatGrid>
      <Card title="Sanctioned vs Filled Strength">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by department, cadre or status…"
          pageSize={15}
          emptyIcon="📊"
          emptyTitle="No staffing plan data"
          emptyMessage="Sanctioned posts versus filled positions are recorded here for DPC planning, UPSC requisitions, and vacancy circulars."
        />
      </Card>
    </main>
  );
}
