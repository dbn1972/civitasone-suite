import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getAttendanceRegularisations } from "../../../../_data/loaders";
import { RegularisationTable } from "./RegularisationTable";

export default async function AttendanceRegularisationPage() {
  const { data: regs, source } = await getAttendanceRegularisations();

  const pending = regs.filter((r) => r.status === "pending").length;
  const approved = regs.filter((r) => r.status === "approved").length;
  const rejected = regs.filter((r) => r.status === "rejected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Attendance Regularisation"
        subtitle="Employee requests to correct attendance records — approval required from HR officer."
        back="/hr/attendance"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label="Total Requests" value={regs.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label="Pending Approval" value={pending} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Approved" value={approved} />
        <StatCard icon="🔴" iconBg="var(--badbg)" label="Rejected" value={rejected} />
      </StatGrid>
      <Card title="Regularisation Requests">
        <RegularisationTable regs={regs} source={source} />
      </Card>
    </main>
  );
}
