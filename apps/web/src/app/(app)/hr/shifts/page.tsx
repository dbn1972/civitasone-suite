import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type ApiShift = {
  id: string;
  name: string;
  startTime?: string;
  endTime?: string;
  breakDuration?: string;
  breakMinutes?: number;
  workingHours?: string;
  workingMinutes?: number;
  applicableTo?: string;
  departments?: string[];
  status: string;
};

type Row = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  breakDuration: string;
  workingHours: string;
  applicableTo: string;
  status: string;
} & Record<string, unknown>;

function formatMinutes(minutes: number | undefined): string {
  if (!minutes) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}.${Math.round((m / 60) * 100) / 10} hrs` : `${h} hrs`;
}

function mapShifts(apiItems: ApiShift[]): Row[] {
  return apiItems.map((s) => ({
    id: s.id,
    name: s.name,
    startTime: s.startTime ?? "—",
    endTime: s.endTime ?? "—",
    breakDuration: s.breakDuration ?? (s.breakMinutes ? `${s.breakMinutes} min` : "—"),
    workingHours: s.workingHours ?? (s.workingMinutes ? formatMinutes(s.workingMinutes) : "—"),
    applicableTo: s.applicableTo ?? (s.departments ? s.departments.join(", ") : "—"),
    status: s.status,
  }));
}

async function getShifts(): Promise<Row[]> {
  const res = await fetchJson<unknown, Row[]>("/api/v1/hrms/shifts", [], {
    telemetryKey: "hr.shifts",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiShift[] })?.data;
      return Array.isArray(arr) ? mapShifts(arr as ApiShift[]) : null;
    },
  });
  return res.data;
}

export default async function ShiftsPage() {
  const items = await getShifts();

  const active = items.filter((i) => i.status === "active").length;
  const departments = new Set(
    items.flatMap((i) => i.applicableTo.split(",").map((d) => d.trim())).filter((d) => d && d !== "—"),
  ).size;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "name", label: "Shift Name" },
    { key: "startTime", label: "Start" },
    { key: "endTime", label: "End" },
    { key: "breakDuration", label: "Break" },
    { key: "workingHours", label: "Working Hours" },
    { key: "applicableTo", label: "Applicable To" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Shift Definitions" subtitle="Shift schedules and their applicable departments." back="/hr" />
      <StatGrid>
        <StatCard icon="🕐" iconBg="#e6f0ff" label="Total Shifts" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="👥" iconBg="#fffbe6" label="Departments" value={departments} />
        <StatCard icon="⏰" iconBg="#f5f5f5" label="Avg Hours" value="—" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Shift Schedule</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by shift name or department…" pageSize={15} />
      </div>
    </main>
  );
}
