import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  date: string;
  checkIn: string;
  checkOut: string;
  checkinSource: string;
  totalHours: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/attendance/checkin-log", [], {
    telemetryKey: "hr.attendance_checkin-log",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function CheckinLogPage() {
  const { data: items, source } = await getData();

  const biometric = items.filter((i) => {
    const s = String(i.checkinSource ?? "").toLowerCase();
    return s === "biometric" || s === "bio" || s === "hardware";
  }).length;
  const missingCheckout = items.filter((i) => !i.checkOut || i.checkOut === "—" || i.checkOut === "").length;

  const columns: { key: keyof Row & string; label: string }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "date", label: "Date" },
    { key: "checkIn", label: "Check-In" },
    { key: "checkOut", label: "Check-Out" },
    { key: "totalHours", label: "Total Hours" },
    { key: "checkinSource", label: "Source" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Check-In Log"
        subtitle="Daily attendance check-in/out records with source tracking (mobile, biometric, manual)."
        back="/hr"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total Records" value={items.length} />
        <StatCard icon="🔒" iconBg="#e6f7f0" label="Biometric" value={biometric} />
        <StatCard icon="⚠️" iconBg="#fff7e6" label="Missing Checkout" value={missingCheckout} />
        <StatCard icon="📱" iconBg="#f5f5f5" label="Mobile / Manual" value={items.length - biometric} />
      </StatGrid>
      <Card title="Check-In Log">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee, department or date…"
          pageSize={20}
          emptyIcon="📍"
          emptyTitle="No check-in records"
          emptyMessage="Employee check-ins from the mobile app or biometric device appear here, with location and timestamp."
        />
      </Card>
    </main>
  );
}
