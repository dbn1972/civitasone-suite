import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, EmptyState, Card } from "@/app/_components/ds";
import {
  getMeeting,
  getAgenda,
  getLiveAttendance,
  getActiveVotes,
} from "../../_data/loaders";
import { MeetingConsole } from "./MeetingConsole";

export const dynamic = "force-dynamic";

export default async function MeetingConsolePage({
  params,
}: {
  params: { meetingId: string };
}) {
  const { meetingId } = params;
  const [meeting, agenda, attendance, activeVotes] = await Promise.all([
    getMeeting(meetingId),
    getAgenda(meetingId),
    getLiveAttendance(meetingId),
    getActiveVotes(meetingId),
  ]);

  if (meeting.source === "error" || !meeting.data) {
    return (
      <>
        <PageHeader
          title="Meeting console"
          subtitle="Run the agenda, attendance, quorum and voting for a meeting."
          back="/meeting/meetings"
          backLabel="Meetings"
        />
        <DataSourceBadge source="error" />
        <Card padding>
          <EmptyState
            icon="🗂️"
            title="Meeting not available"
            message="This meeting couldn't be loaded. It may have been cancelled, or live data couldn't be reached. Go back and pick another meeting."
          />
          <div style={{ marginTop: 12 }}>
            <Link className="btn ghost sm" href="/meeting/meetings">
              ← Back to meetings
            </Link>
          </div>
        </Card>
      </>
    );
  }

  const degraded =
    agenda.source === "error" ||
    attendance.source === "error" ||
    activeVotes.source === "error";

  return (
    <>
      <PageHeader
        title={meeting.data.title || "Meeting console"}
        subtitle="Run the agenda, track attendance and quorum, and manage the live voting panel."
        back="/meeting/meetings"
        backLabel="Meetings"
      />
      {degraded && <DataSourceBadge source="error" />}
      <MeetingConsole
        meeting={meeting.data}
        agenda={agenda.data}
        agendaSource={agenda.source}
        initialAttendance={attendance.data}
        attendanceSource={attendance.source}
        initialActiveVotes={activeVotes.data}
        activeVotesSource={activeVotes.source}
      />
    </>
  );
}
