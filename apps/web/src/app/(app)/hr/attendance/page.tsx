import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getAttendanceList } from "../../../_data/loaders";
import { AttendanceTable } from "./AttendanceTable";

export default async function AttendancePage() {
  const { data: attendance, source } = await getAttendanceList();

  const total = attendance.length;
  const present = attendance.filter((r) => r.status === "present").length;
  const absent = attendance.filter((r) => r.status === "absent").length;
  const onLeave = attendance.filter((r) => r.status === "on_leave").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Attendance"
        subtitle="Daily presence and punctuality records."
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--panel)" label="Total Records" value={total} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Present" value={present} />
        <StatCard icon="❌" iconBg="var(--badbg)" label="Absent" value={absent} />
        <StatCard icon="🌴" iconBg="var(--warnbg)" label="On Leave" value={onLeave} />
      </StatGrid>
      <Card title="Attendance Records">
        <AttendanceTable attendance={attendance} source={source} />
      </Card>
    </main>
  );
}
