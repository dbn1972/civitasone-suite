import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getAttendanceRegularisations } from "../../../../_data/loaders";
import { RegularisationTable } from "./RegularisationTable";
import { getTranslations } from "next-intl/server";

export default async function AttendanceRegularisationPage() {
  const t = await getTranslations("attendanceRegularisation");
  const { data: regs, source } = await getAttendanceRegularisations();

  const pending = regs.filter((r) => r.status === "pending").length;
  const approved = regs.filter((r) => r.status === "approved").length;
  const rejected = regs.filter((r) => r.status === "rejected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitlePage")}
        back="/hr/attendance"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotal")} value={regs.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={pending} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApproved")} value={approved} />
        <StatCard icon="🔴" iconBg="var(--badbg)" label={t("statRejected")} value={rejected} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        <RegularisationTable regs={regs} source={source} />
      </Card>
    </main>
  );
}
