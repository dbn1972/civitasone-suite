import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  program: string;
  nominatedBy: string;
  nominationDate: string;
  programDate: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/training/nominations", [], {
    telemetryKey: "hr.training_nominations",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function TrainingNominationsPage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "program", label: "Program" },
    { key: "nominatedBy", label: "Nominated By" },
    { key: "programDate", label: "Program Date" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Training Nominations" subtitle="Nominations for upcoming training programs." back="/hr" />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={items.filter((i) => i.status === "pending").length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={items.filter((i) => i.status === "approved").length} />
        <StatCard icon="📚" iconBg="#f5f5f5" label="Programs" value={new Set(items.map((i) => i.program)).size} />
      </StatGrid>
      <Card title="Training Nominations">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…"
          pageSize={15}
          emptyIcon="🎓"
          emptyTitle="No training nominations"
          emptyMessage="Employee nominations for training programmes appear here. Nominations are approved by the department head before enrolment."
        />
      </Card>
    </main>
  );
}
