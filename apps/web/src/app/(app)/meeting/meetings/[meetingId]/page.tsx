import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, RefreshErrorState } from "@/app/_components/ds";
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
    // Note: the loader (fetchJson) folds a real 404 ("this meeting doesn't
    // exist / was cancelled") and a transient failure (network/gateway down)
    // into the same source:"error" signal — there isn't enough information
    // at this layer to tell them apart, so we show one message that's
    // truthful for both and offer a real retry via RefreshErrorState.
    return (
      <>
        <PageHeader
          title="Meeting console"
          subtitle="Run the agenda, attendance, quorum and voting for a meeting."
          back="/meeting/meetings"
          backLabel="Meetings"
        />
        <RefreshErrorState
          error={{
            what: "This meeting couldn't be loaded.",
            next: "It may have been cancelled, or live data couldn't be reached. Try again, or go back and pick another meeting.",
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
