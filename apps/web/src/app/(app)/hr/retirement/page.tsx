import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  designation: string;
  dob: string;
  superannuationDate: string;
  separationType: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/workforce/retirement-forecast", [], {
    telemetryKey: "hr.retirement",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function RetirementPage() {
  const items = await getData();

  const upcoming = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed").length;
  const vrs = items.filter((i) => i.separationType === "VRS").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "designation", label: "Designation" },
    { key: "superannuationDate", label: "Superannuation Date" },
    { key: "separationType", label: "Type" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Retirement & Separation" subtitle="Upcoming retirements and separation queue." back="/hr" />
      <StatGrid>
        <StatCard icon="👴" iconBg="#e6f0ff" label="Total" value={items.length} />
        <StatCard icon="📅" iconBg="#fffbe6" label="Upcoming" value={upcoming} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Processed" value={completed} />
        <StatCard icon="📝" iconBg="#f5f5f5" label="VRS" value={vrs} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Retirement Queue</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, department or date…" pageSize={15} />
      </div>
    </main>
  );
}
