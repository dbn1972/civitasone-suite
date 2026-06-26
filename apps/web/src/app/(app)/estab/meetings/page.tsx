import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getMeetings } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { MeetingsTable, type MeetingRow } from "./MeetingsTable";

export default async function MeetingsPage() {
  const { data: meetings, source } = await getMeetings();
  const today = new Date().toISOString().split("T")[0];
  const upcoming = meetings.filter((m) => m.status === "scheduled" && m.scheduledDate >= today).length;
  const completed = meetings.filter((m) => m.status === "completed").length;
  const momPending = meetings.filter((m) => m.status === "in_progress").length;
  const totalActions = meetings.length;

  const rows: MeetingRow[] = meetings.map((m) => ({
    id: m.id,
    meetingNo: m.meetingNo,
    title: m.title,
    when: `${formatIndianDate(m.scheduledDate)}${m.scheduledTime ? ` · ${m.scheduledTime}` : ""}`,
    venue: m.venue ?? "—",
    attendees: m.attendeesCount,
    status: m.status.replace(/_/g, " "),
    upcoming: m.scheduledDate >= today,
  }));

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Meeting Management"
        subtitle="Schedule meetings, prepare agenda, capture MOM & track actions."
        actions={
          <>
            <button className="btn ghost">Calendar</button>
            <button className="btn primary">+ Schedule</button>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="📅" iconBg="#e6f7f5" label="Meetings (wk)" value={upcoming.toLocaleString("en-IN")} />
        <StatCard icon="📝" iconBg="#fffaeb" label="MOM Pending" value={momPending.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#eff6ff" label="Action Items" value={totalActions.toLocaleString("en-IN")} />
        <StatCard icon="📊" iconBg="#ecfdf3" label="Compliance" value={completed > 0 ? `${Math.round((completed / meetings.length) * 100)}%` : "—"} delta="+3%" up />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {meetings.length === 0 ? (
          <>
            <div className="card-h">
              <h3>Meetings</h3>
            </div>
            <EmptyState icon="📅" title="No meetings found" message="Schedule a meeting to get started." />
          </>
        ) : (
          <MeetingsTable rows={rows} />
        )}
      </div>
    </>
  );
}
