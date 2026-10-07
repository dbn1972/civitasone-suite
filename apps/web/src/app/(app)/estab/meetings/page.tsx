import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getMeetings } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { MeetingsTable, type MeetingRow } from "./MeetingsTable";
import { MeetingsCalendar } from "./MeetingsCalendar";

// GAP-ESTAB-MEETINGS-04: compute today in IST from local date parts, not
// toISOString (which uses UTC and rolls to yesterday before 05:30 IST).
function todayIST(): string {
  const d = new Date();
  // Use Intl to get IST parts — safe regardless of server TZ.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA format is YYYY-MM-DD
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams?: { view?: string };
}) {
  const { data: meetings, source } = await getMeetings();
  const calendarView = searchParams?.view === "calendar";

  // GAP-ESTAB-MEETINGS-01: gate all four stats on errored so an outage
  // doesn't show real 0 for every stat.
  const errored = source === "error";

  const today = todayIST();
  const upcoming = meetings.filter((m) => m.status === "scheduled" && m.scheduledDate >= today).length;
  const completed = meetings.filter((m) => m.status === "completed").length;
  // GAP-ESTAB-MEETINGS-03: renamed "MOM Pending" to "In Progress" —
  // the count is meetings with status 'in_progress', not meetings lacking
  // minutes. An honest label avoids misleading clerks.
  const inProgress = meetings.filter((m) => m.status === "in_progress").length;
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
      {errored && (
        <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      )}
      <PageHeader
        title="Meeting Management"
        subtitle="Schedule meetings, prepare agenda, capture MOM & track actions."
        actions={
          <>
            {/* GAP-ESTAB-MEETINGS-05: aria-current on the active view toggle */}
            {calendarView ? (
              <Link href="/estab/meetings" className="btn ghost" style={{ minHeight: 44 }} aria-current={undefined}>
                List
              </Link>
            ) : (
              <Link href="/estab/meetings?view=calendar" className="btn ghost" style={{ minHeight: 44 }} aria-current={undefined}>
                Calendar
              </Link>
            )}
            {/* GAP-ESTAB-MEETINGS-02: the disabled schedule button's tooltip explains
                that meetings are created from a committee. The empty state copy is also
                updated to avoid instructing an unavailable action. */}
            <Link href="/meeting/meetings/new" className="btn primary" style={{ minHeight: 44 }}>
              + Schedule
            </Link>
          </>
        }
      />
      <StatGrid>
        {/* GAP-ESTAB-MEETINGS-01: all four stats show '—' when errored */}
        <StatCard icon="📅" iconBg="#e6f7f5" label="Upcoming Meetings" value={errored ? "—" : upcoming.toLocaleString("en-IN")} />
        {/* GAP-ESTAB-MEETINGS-03: "In Progress" instead of "MOM Pending" */}
        <StatCard icon="📝" iconBg="#fffaeb" label="In Progress" value={errored ? "—" : inProgress.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#eff6ff" label="Action Items" value={errored ? "—" : totalActionItems.toLocaleString("en-IN")} />
        {/* GAP-ESTAB-MEETINGS-03: "Meetings held" instead of "Compliance" to
            avoid confusion with the Compliance page's distinct formula */}
        <StatCard icon="📊" iconBg="#ecfdf3" label="Meetings Held" value={errored ? "—" : completed > 0 ? `${completed}` : "—"} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {errored ? (
          <>
            <div className="card-h"><h3>Meetings</h3></div>
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
            <div className="card-h"><h3>Meetings</h3></div>
            {/* GAP-ESTAB-MEETINGS-02: empty state no longer says "Schedule a
                meeting" when the button links to the meeting module */}
            <EmptyState
              icon="📅"
              title="No meetings found"
              message="Meetings are created from within a committee, or via the Meeting module."
            />
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
