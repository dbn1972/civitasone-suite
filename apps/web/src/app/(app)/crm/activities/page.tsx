import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCRMActivities } from "../../../_data/loaders";
import { ActivitiesTable } from "./ActivitiesTable";
import { LogActivityButton } from "./LogActivityButton";

export default async function Page() {
  const { data: activities, source } = await getCRMActivities();

  const dueToday = activities.filter((a) => a.dueDate === new Date().toISOString().slice(0, 10)).length;
  const overdue = activities.filter((a) => a.status === "overdue").length;
  const completed = activities.filter((a) => a.status === "completed").length;

  return (
    <>
      <PageHeader
        title="CRM Activities"
        subtitle="Calls, meetings, emails, tasks and notes."
        back="/crm"
        actions={<LogActivityButton />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="⚡" iconBg="#fce7ee" label="Total" value={activities.length.toLocaleString("en-IN")} />
        <StatCard icon="📅" iconBg="#fce7ee" label="Due Today" value={dueToday.toLocaleString("en-IN")} />
        <StatCard icon="🔴" iconBg="#fef2f2" label="Overdue" value={overdue.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Completed" value={completed.toLocaleString("en-IN")} />
      </StatGrid>
      <ActivitiesTable activities={activities} />
    </>
  );
}
