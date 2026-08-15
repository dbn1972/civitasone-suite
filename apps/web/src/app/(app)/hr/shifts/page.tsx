import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { ShiftCard } from "../_components/ShiftCard";

/**
 * ShiftsListPage — displays and manages shift definitions.
 * GoI context: Standard Govt working hours = 09:00–17:30 Mon–Fri per DoPT O.M.
 */

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
  return m ? `${h}h ${m}m` : `${h} hrs`;
}

function mapShifts(apiItems: ApiShift[]): Row[] {
  return apiItems.map((s) => ({
    id: s.id,
    name: s.name,
    startTime: s.startTime ?? "—",
    endTime: s.endTime ?? "—",
    breakDuration: s.breakDuration ?? (s.breakMinutes ? `${s.breakMinutes} min` : "—"),
    workingHours: s.workingHours ?? formatMinutes(s.workingMinutes),
    applicableTo: s.applicableTo ?? (s.departments?.join(", ") ?? "—"),
    status: s.status,
  }));
}

async function getShifts(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/shifts", [], {
    telemetryKey: "hr.shifts",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiShift[] })?.data;
      return Array.isArray(arr) ? mapShifts(arr as ApiShift[]) : null;
    },
  });
}

const COLUMNS: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
  { key: "name", label: "Shift Name" },
  { key: "startTime", label: "Start" },
  { key: "endTime", label: "End" },
  { key: "breakDuration", label: "Break" },
  { key: "workingHours", label: "Working Hours" },
  { key: "applicableTo", label: "Applicable To" },
  { key: "status", label: "Status", cellType: "status" },
];

const GOVT_SHIFTS: Row[] = [
  { id: "dopt-general", name: "General Duty", startTime: "09:00", endTime: "17:30", breakDuration: "30 min", workingHours: "8 hrs", applicableTo: "All Cadres (DoPT O.M.)", status: "active" },
  { id: "dopt-morning", name: "Morning Shift", startTime: "06:00", endTime: "14:00", breakDuration: "30 min", workingHours: "7.5 hrs", applicableTo: "Operational Staff", status: "active" },
  { id: "dopt-evening", name: "Evening Shift", startTime: "14:00", endTime: "22:00", breakDuration: "30 min", workingHours: "7.5 hrs", applicableTo: "Operational Staff", status: "active" },
  { id: "dopt-night", name: "Night Shift", startTime: "22:00", endTime: "06:00", breakDuration: "30 min", workingHours: "7.5 hrs", applicableTo: "Essential Services", status: "active" },
];

export default async function ShiftsPage() {
  const { data: apiItems, source } = await getShifts();
  const items = apiItems.length > 0 ? apiItems : GOVT_SHIFTS;

  const active = items.filter((i) => i.status === "active").length;
  const departments = new Set(
    items.flatMap((i) => i.applicableTo.split(",").map((d) => d.trim())).filter((d) => d && d !== "—"),
  ).size;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Shift Definitions"
        subtitle="Manage shift schedules and department assignments. GoI standard hours: 09:00–17:30 Mon–Fri (DoPT O.M.)."
        back="/hr"
        actions={
          <Link href="/hr/shifts/requests" className="btn ghost" aria-label="View shift change requests">
            Change Requests
          </Link>
        }
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🕐" iconBg="#e6f0ff" label="Total Shifts" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="👥" iconBg="#fffbe6" label="Departments" value={departments} />
        <StatCard icon="⏰" iconBg="#f5f5f5" label="Std Hours" value="8 hrs" />
      </StatGrid>

      {/* Card view for the first 4 shifts */}
      {items.length > 0 && (
        <section aria-label="Shift cards" style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 14,
            }}
          >
            {items.slice(0, 6).map((shift) => (
              <ShiftCard key={shift.id} {...shift} />
            ))}
          </div>
        </section>
      )}

      <Card title="All Shift Definitions">
        <DataTable<Row>
          columns={COLUMNS}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by shift name or department…"
          pageSize={15}
          emptyIcon="🕐"
          emptyTitle="No shifts defined"
          emptyMessage="Shift schedules (Morning, Evening, Night, General) appear here. Define shifts and assign departments to enable attendance tracking."
        />
      </Card>
    </main>
  );
}
