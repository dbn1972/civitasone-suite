/**
 * Workflow / movement timeline of a meeting (GAP-ESTAB-MEETINGS-DETAIL-02).
 *
 * The service records a meeting's status, not an event log, so each stage here is INFERRED from
 * that status: no stage carries an invented date or actor. Only "Scheduled" has a real date (the
 * meeting's scheduled date); every other stage renders no date slot at all rather than an empty
 * one. A cancelled meeting never shows its agenda as circulated.
 */
export type MeetingTimelineLabels = {
  scheduled: string;
  agendaCirculated: string;
  held: string;
  momIssued: string;
  actionsClosed: string;
};

export type MeetingTimelineProps = {
  status: string;
  /** The meeting's scheduled date, already formatted for display. */
  scheduledDate: string;
  hasMinutes: boolean;
  actionPointStatuses: string[];
  labels: MeetingTimelineLabels;
};

type StageState = "done" | "cur" | "todo";

export function meetingStages(p: Pick<MeetingTimelineProps, "status" | "hasMinutes" | "actionPointStatuses">): Record<"agenda" | "held" | "mom" | "actions", StageState> {
  const { status } = p;
  return {
    // Cancelled does NOT imply the agenda was circulated.
    agenda: status === "scheduled" || status === "cancelled" ? "todo" : "done",
    held: status === "in_progress" ? "cur" : status === "completed" ? "done" : "todo",
    mom: status === "completed" && p.hasMinutes ? "done" : "todo",
    // [].every() is vacuously true: require a completed meeting AND at least one action point, all completed.
    actions:
      status === "completed" && p.actionPointStatuses.length > 0 && p.actionPointStatuses.every((s) => s === "completed")
        ? "done"
        : "todo",
  };
}

export function MeetingTimeline({ status, scheduledDate, hasMinutes, actionPointStatuses, labels }: MeetingTimelineProps) {
  const stages = meetingStages({ status, hasMinutes, actionPointStatuses });
  return (
    <ul className="tl">
      <li className="done">
        <div className="t">{labels.scheduled}</div>
        {scheduledDate ? <div className="d">{scheduledDate}</div> : null}
      </li>
      <li className={stages.agenda}><div className="t">{labels.agendaCirculated}</div></li>
      <li className={stages.held}><div className="t">{labels.held}</div></li>
      <li className={stages.mom}><div className="t">{labels.momIssued}</div></li>
      <li className={stages.actions}><div className="t">{labels.actionsClosed}</div></li>
    </ul>
  );
}
