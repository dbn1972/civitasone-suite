import { getTranslations } from "next-intl/server";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCRMActivities } from "../../../_data/loaders";
import { todayIST, istDatePart } from "@/lib/formatters";
import { ActivitiesTable } from "./ActivitiesTable";
import { LogActivityButton } from "./LogActivityButton";

export default async function Page({ searchParams }: { searchParams?: { segment?: string } }) {
  const t = await getTranslations("crm.activities");
  const { data: activities, source } = await getCRMActivities();

  // Never fabricate a 0 count when the list load failed — show "—" instead
  // (matches the pattern already used on dashboard/accounts/contacts).
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));

  // GAP-CRM-ACTIVITIES-03: resolve "today" once in IST on the server and pass it
  // to the client table, so the dueToday stat and the Today segment agree and
  // never key off the UTC calendar date (which is yesterday 00:00–05:30 IST).
  const today = todayIST();
  const dueToday = activities.filter((a) => istDatePart(a.dueDate) === today).length;
  const overdue = activities.filter((a) => a.status === "overdue").length;
  const completed = activities.filter((a) => a.status === "completed").length;

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
        actions={<LogActivityButton
          buttonLabel={t("logButton")}
          heading={t("logHeading")}
          savedMessage={t("logSaved")}
        />}
      />
      <StatGrid>
        <StatCard icon="▣" iconBg="#f0f9ff" label={t("statTotal")} value={stat(activities.length)} />
        <StatCard icon="△" iconBg="#fffaeb" label="Due Today" value={stat(dueToday)} />
        <StatCard icon="◈" iconBg="#fef2f2" label="Overdue" value={stat(overdue)} />
        <StatCard icon="○" iconBg="#ecfdf5" label="Completed" value={stat(completed)} />
      </StatGrid>
      {/* ?segment= lets a caller (e.g. the Control Tower's "Overdue follow-ups"
          exception drill-down) land straight on the matching toggle instead of
          the generic "All" view. GAP-CRM-ACTIVITIES-02: pass `source` so the
          table shows a retry on an outage instead of the empty-register copy;
          GAP-CRM-ACTIVITIES-03: pass the IST `today` so client/server agree. */}
      <ActivitiesTable activities={activities} initialSegment={searchParams?.segment} source={source} today={today} heading={t("tableHeading")} emptyTitle={t("emptyTitle")} />
    </>
  );
}
