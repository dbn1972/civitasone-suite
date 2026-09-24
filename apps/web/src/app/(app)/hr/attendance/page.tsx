import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getAttendanceList } from "../../../_data/loaders";
import { AttendanceTable } from "./AttendanceTable";
import { getTranslations } from "next-intl/server";

export default async function AttendancePage() {
  const t = await getTranslations("attendance");
  const { data: attendance, source } = await getAttendanceList();

  const total = attendance.length;
  const present = attendance.filter((r) => r.status === "present").length;
  const absent = attendance.filter((r) => r.status === "absent").length;
  const onLeave = attendance.filter((r) => r.status === "on_leave").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      {/* UX-012: the data-source badge now lives inside AttendanceTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--panel)" label={t("total")} value={total} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("present")} value={present} />
        <StatCard icon="❌" iconBg="var(--badbg)" label={t("absent")} value={absent} />
        <StatCard icon="🌴" iconBg="var(--warnbg)" label={t("onLeave")} value={onLeave} />
      </StatGrid>
      <Card title={t("recordsCardTitle")}>
        <AttendanceTable attendance={attendance} source={source} />
      </Card>
    </main>
  );
}
