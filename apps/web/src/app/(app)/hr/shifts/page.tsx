import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

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

const items: Row[] = [
  { id: "1", name: "General Shift", startTime: "09:00", endTime: "17:30", breakDuration: "30 min", workingHours: "8 hrs", applicableTo: "All Departments", status: "active" },
  { id: "2", name: "Morning Shift", startTime: "06:00", endTime: "14:00", breakDuration: "30 min", workingHours: "7.5 hrs", applicableTo: "Security, Housekeeping", status: "active" },
  { id: "3", name: "Evening Shift", startTime: "14:00", endTime: "22:00", breakDuration: "30 min", workingHours: "7.5 hrs", applicableTo: "Security, IT Ops", status: "active" },
  { id: "4", name: "Night Shift", startTime: "22:00", endTime: "06:00", breakDuration: "45 min", workingHours: "7.25 hrs", applicableTo: "IT Ops, Data Centre", status: "active" },
  { id: "5", name: "Flexible Shift", startTime: "08:00–10:00", endTime: "16:30–18:30", breakDuration: "30 min", workingHours: "8 hrs", applicableTo: "IT, Research", status: "active" },
  { id: "6", name: "Half Day", startTime: "09:00", endTime: "13:00", breakDuration: "—", workingHours: "4 hrs", applicableTo: "Saturday (Alt)", status: "active" },
];

export default function ShiftsPage() {
  const active = items.filter((i) => i.status === "active").length;

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
        <StatCard icon="👥" iconBg="#fffbe6" label="Departments" value={7} />
        <StatCard icon="⏰" iconBg="#f5f5f5" label="Avg Hours" value="7.5 hrs" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Shift Schedule</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by shift name or department…" pageSize={15} />
      </div>
    </main>
  );
}
