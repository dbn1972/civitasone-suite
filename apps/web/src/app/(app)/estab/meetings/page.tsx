import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getMeetings } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { MeetingsTable, type MeetingRow } from "./MeetingsTable";
import { MeetingsCalendar } from "./MeetingsCalendar";

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams?: { view?: string };
}) {
  const { data: meetings, source } = await getMeetings();
  const calendarView = searchParams?.view === "calendar";
  const today = new Date().toISOString().split("T")[0];
  const upcoming = meetings.filter((m) => m.status === "scheduled" && m.scheduledDate >= today).length;
  const completed = meetings.filter((m) => m.status === "completed").length;
  const momPending = meetings.filter((m) => m.status === "in_progress").length;
  // Backed by the real per-meeting agendaItemsCount field (estab-service now computes it from
  // estab_resolutions -- see queries.ts -- rather than always returning 0). Labeled "Action
  // Items" rather than "Agenda Items": estab's meeting model has no distinct agenda-item
  // concept, and resolutions are already this feature's action-point equivalent (see the
  // per-meeting detail view's `actionPoints`).
  const totalActionItems = meetings.reduce((sum, m) => sum + m.agendaItemsCount, 0);

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
      {source === "error" && (
        <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      )}
      <PageHeader
        title="Meeting Management"
        subtitle="Schedule meetings, prepare agenda, capture MOM & track actions."
        actions={
          <>
            {calendarView ? (
              <Link href="/estab/meetings" className="btn ghost" style={{ minHeight: 44 }}>
                List
              </Link>
            ) : (
              <Link href="/estab/meetings?view=calendar" className="btn ghost" style={{ minHeight: 44 }}>
                Calendar
              </Link>
            )}
            <button
              type="button"
              className="btn primary"
              style={{ minHeight: 44 }}
              disabled
              aria-disabled="true"
              title="Scheduling from this page is coming soon — meetings are created from within a committee today."
            >
              + Schedule{" "}
              <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>(coming soon)</span>
            </button>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="📅" iconBg="#e6f7f5" label="Upcoming Meetings" value={upcoming.toLocaleString("en-IN")} />
        <StatCard icon="📝" iconBg="#fffaeb" label="MOM Pending" value={momPending.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#eff6ff" label="Action Items" value={totalActionItems.toLocaleString("en-IN")} />
        <StatCard icon="📊" iconBg="#ecfdf3" label="Compliance" value={completed > 0 ? `${Math.round((completed / meetings.length) * 100)}%` : "—"} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {source === "error" ? (
          <>
            <div className="card-h">
              <h3>Meetings</h3>
            </div>
            <RefreshErrorState
              error={{
                what: "We couldn't load meetings.",
                next: "Check your connection and try again.",
                actions: ["retry", "help"],
              }}
            />
          </>
        ) : meetings.length === 0 ? (
          <>
            <div className="card-h">
              <h3>Meetings</h3>
            </div>
            <EmptyState icon="📅" title="No meetings found" message="Schedule a meeting to get started." />
          </>
        ) : calendarView ? (
          <MeetingsCalendar meetings={meetings} />
        ) : (
          <MeetingsTable rows={rows} />
        )}
      </div>
    </>
  );
}
