import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  date: string;
  checkIn: string;
  checkOut: string;
  source: string;
  totalHours: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", department: "Finance", date: "22/07/2024", checkIn: "09:02", checkOut: "17:35", source: "Biometric", totalHours: "8h 33m" },
  { id: "2", employee: "Priya Sharma", department: "HR", date: "22/07/2024", checkIn: "08:55", checkOut: "17:30", source: "Biometric", totalHours: "8h 35m" },
  { id: "3", employee: "Amit Patel", department: "IT", date: "22/07/2024", checkIn: "09:15", checkOut: "18:45", source: "Geo-fence", totalHours: "9h 30m" },
  { id: "4", employee: "Sunita Rao", department: "Legal", date: "22/07/2024", checkIn: "09:30", checkOut: "17:00", source: "Manual", totalHours: "7h 30m" },
  { id: "5", employee: "Vikram Singh", department: "Admin", date: "22/07/2024", checkIn: "08:45", checkOut: "17:30", source: "Biometric", totalHours: "8h 45m" },
  { id: "6", employee: "Deepak Kumar", department: "IT", date: "22/07/2024", checkIn: "10:00", checkOut: "19:15", source: "Geo-fence", totalHours: "9h 15m" },
  { id: "7", employee: "Meera Iyer", department: "Accounts", date: "22/07/2024", checkIn: "09:05", checkOut: "17:40", source: "Biometric", totalHours: "8h 35m" },
  { id: "8", employee: "Kavita Nair", department: "Procurement", date: "22/07/2024", checkIn: "09:10", checkOut: "—", source: "Biometric", totalHours: "—" },
];

export default function CheckinLogPage() {
  const biometric = items.filter((i) => i.source === "Biometric").length;
  const geofence = items.filter((i) => i.source === "Geo-fence").length;
  const manual = items.filter((i) => i.source === "Manual").length;

  const columns: { key: keyof Row & string; label: string }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "date", label: "Date" },
    { key: "checkIn", label: "Check-In" },
    { key: "checkOut", label: "Check-Out" },
    { key: "totalHours", label: "Total Hours" },
    { key: "source", label: "Source" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Check-In Log" subtitle="Daily attendance check-in/out records with source tracking." back="/hr" />
      <StatGrid>
        <StatCard icon="📍" iconBg="#e6f0ff" label="Today's Entries" value={items.length} />
        <StatCard icon="🖐️" iconBg="#e6f7f0" label="Biometric" value={biometric} />
        <StatCard icon="📱" iconBg="#fffbe6" label="Geo-fence" value={geofence} />
        <StatCard icon="✍️" iconBg="#f5f5f5" label="Manual" value={manual} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Attendance Log</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, source or date…" pageSize={15} />
      </div>
    </main>
  );
}
