import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type ApiWorkSummary = {
  id: string;
  employeeId?: string;
  employeeName?: string;
  department?: string;
  period?: string;
  periodFrom?: string;
  periodTo?: string;
  periodType?: string;
  tasksCompleted?: number;
  totalTasks?: number;
  rating?: number;
  status: string;
};

type Row = {
  id: string;
  employee: string;
  department: string;
  period: string;
  periodType: string;
  tasksCompleted: string;
  rating: string;
  status: string;
} & Record<string, unknown>;

function formatDateRange(from?: string, to?: string): string {
  if (!from && !to) return "—";
  try {
    const fmtDate = (s: string) => {
      const d = new Date(s);
      if (isNaN(d.getTime())) return s;
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
    };
    if (from && to) return `${fmtDate(from)} – ${fmtDate(to)}`;
    return from ? fmtDate(from) : fmtDate(to!);
  } catch {
    return `${from ?? ""} – ${to ?? ""}`;
  }
}

function mapWorkSummaries(apiItems: ApiWorkSummary[]): Row[] {
  return apiItems.map((s) => ({
    id: s.id,
    employee: s.employeeName ?? s.employeeId ?? "—",
    department: s.department ?? "—",
    period: s.period ?? formatDateRange(s.periodFrom, s.periodTo),
    periodType: s.periodType ?? "—",
    tasksCompleted: s.tasksCompleted != null && s.totalTasks != null
      ? `${s.tasksCompleted}/${s.totalTasks}`
      : "—",
    rating: s.rating != null ? `${s.rating}/5` : "—",
    status: s.status,
  }));
}

async function getWorkSummaries(): Promise<LoaderResult<Row[]>> {
  const res = await fetchJson<unknown, Row[]>("/api/v1/hrms/work-summaries", [], {
    telemetryKey: "hr.work-summaries",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiWorkSummary[] })?.data;
      return Array.isArray(arr) ? mapWorkSummaries(arr as ApiWorkSummary[]) : null;
    },
  });
  return res;
}

export default async function WorkSummaryPage() {
  const { data: items, source } = await getWorkSummaries();

  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const weekly = items.filter((i) => i.periodType.toLowerCase() === "weekly").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "period", label: "Period" },
    { key: "periodType", label: "Type" },
    { key: "tasksCompleted", label: "Tasks" },
    { key: "rating", label: "Rating" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Work Summaries" subtitle="Weekly and monthly work summary submissions with supervisor ratings." back="/hr" />
      <StatGrid>
        <StatCard icon="📝" iconBg="#e6f0ff" label="Total Summaries" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Reviewed" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending Review" value={pending} />
        <StatCard icon="📅" iconBg="#f5f5f5" label="Weekly" value={weekly} />
      </StatGrid>
      <Card title="Work Summaries">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, period or status…"
          pageSize={15}
          emptyIcon="📝"
          emptyTitle="No work summaries yet"
          emptyMessage="Employee work summaries appear here once submitted. Summaries record tasks completed and receive a supervisor rating."
        />
      </Card>
    </main>
  );
}
