import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, RefreshErrorState, EmptyState } from "@/app/_components/ds";
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
    // GAP-MEETING-MEETINGS-MEETINGID-05: the loader carries the raw HTTP
    // `status`, so a real 404 (cancelled / never existed) and an access
    // boundary (401/403) can be told apart from a transient failure instead
    // of all collapsing into "couldn't be loaded". Only a transient failure
    // gets a Retry — retrying a 404 or a 403 can never succeed.
    const header = (
      <PageHeader
        title="Meeting console"
        subtitle="Run the agenda, attendance, quorum and voting for a meeting."
        back="/meeting/meetings"
        backLabel="Meetings"
      />
    );

    if (meeting.status === 404) {
      return (
        <>
          {header}
          <EmptyState
            icon="🗂️"
            title="Meeting not found"
            message="This meeting may have been cancelled or never existed. Go back and pick another meeting."
          />
        </>
      );
    }

    if (meeting.status === 401 || meeting.status === 403) {
      return (
        <>
          {header}
          <EmptyState
            icon="🔒"
            title="You don't have access to this meeting"
            message="You may not be a participant, or your role doesn't permit viewing it. Contact the secretariat if you believe this is an error."
          />
        </>
      );
    }

    return (
      <>
        {header}
        <RefreshErrorState
          error={{
            what: "This meeting couldn't be loaded.",
            next: "Live data couldn't be reached. Try again, or go back and pick another meeting.",
            actions: ["retry", "back", "help"],
          }}
          backHref="/meeting/meetings"
        />
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
      {degraded && (
        <DataSourceBadge
          source="error"
          message="Some panels below couldn't load — showing nothing for those"
        />
      )}
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
