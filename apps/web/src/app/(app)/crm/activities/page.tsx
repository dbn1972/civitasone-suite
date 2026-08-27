import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCRMActivities } from "../../../_data/loaders";
import { ActivitiesTable } from "./ActivitiesTable";
import { LogActivityButton } from "./LogActivityButton";

export default async function Page({ searchParams }: { searchParams?: { segment?: string } } = {}) {
  const { data: activities, source } = await getCRMActivities();

  // Never fabricate a 0 count when the list load failed — show "—" instead
  // (matches the pattern already used on dashboard/accounts/contacts).
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));

  const dueToday = activities.filter((a) => a.dueDate === new Date().toISOString().slice(0, 10)).length;
  const overdue = activities.filter((a) => a.status === "overdue").length;
  const completed = activities.filter((a) => a.status === "completed").length;

  return (
    <>
      <PageHeader
        title="Stakeholder Interactions"
        subtitle="Calls, meetings, site visits and correspondence with citizens, vendors and government officials • अन्तःक्रियाएँ"
        back="/crm"
        actions={<LogActivityButton />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="▣" iconBg="#f0f9ff" label="Total Interactions" value={stat(activities.length)} />
        <StatCard icon="△" iconBg="#fffaeb" label="Due Today" value={stat(dueToday)} />
        <StatCard icon="◈" iconBg="#fef2f2" label="Overdue" value={stat(overdue)} />
        <StatCard icon="○" iconBg="#ecfdf5" label="Completed" value={stat(completed)} />
      </StatGrid>
      {/* ?segment= lets a caller (e.g. the Control Tower's "Overdue follow-ups"
          exception drill-down) land straight on the matching toggle instead of
          the generic "All" view. */}
      <ActivitiesTable activities={activities} initialSegment={searchParams?.segment} />
    </>
  );
}
