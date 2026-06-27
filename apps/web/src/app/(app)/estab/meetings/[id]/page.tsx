import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getMeetingById } from "../../../../_data/loaders";
import { PageHeader, StatusPill } from "../../../../_components/ds";
import { ActionPointsTable, AttendeesTable } from "./MeetingDetailTables";
import { MeetingActions } from "./MeetingActions";

export default async function MeetingDetailPage({ params }: { params: { id: string } }) {
  const { data: meeting, source } = await getMeetingById(params.id);

  if (!meeting) {
    return (
      <>
        <PageHeader title="Meeting not found" back="/estab/meetings" />
        <p className="sub">The requested meeting could not be found.</p>
      </>
    );
  }

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <a className="back" href="/estab/meetings">← Back</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <div>
          <h1>
            {meeting.title}{" "}
            <StatusPill status={meeting.status.replace(/_/g, " ")} label={meeting.status.replace(/_/g, " ")} />
          </h1>
        </div>
        <div className="ph-act">
          <MeetingActions meetingId={params.id} />
        </div>
      </div>
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Date</div><div className="v">{meeting.scheduledDate}{meeting.scheduledTime ? ` · ${meeting.scheduledTime}` : ""}</div></div>
              <div className="fld"><div className="l">Venue</div><div className="v">{meeting.venue ?? "—"}</div></div>
              <div className="fld"><div className="l">Chair</div><div className="v">{meeting.chairperson ?? "—"}</div></div>
              <div className="fld"><div className="l">Attendees</div><div className="v">{meeting.attendeesCount}</div></div>
              <div className="fld"><div className="l">Agenda items</div><div className="v">{meeting.agenda.length}</div></div>
              <div className="fld"><div className="l">MOM</div><div className="v">{meeting.minutes ? "Captured" : "Draft"}</div></div>
            </div>
          </div>
          {meeting.actionPoints.length > 0 ? (
            <div className="card">
              <div className="card-h"><h3>Action items (MOM)</h3></div>
              <ActionPointsTable rows={meeting.actionPoints} />
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Workflow / movement</h3></div>
            <div className="pad">
              <ul className="tl">
                <li className="done"><div className="t">Scheduled</div><div className="d"></div></li>
                <li className={meeting.status === "scheduled" ? "cur" : "done"}><div className="t">Agenda circulated</div><div className="d"></div></li>
                <li className={meeting.status === "in_progress" ? "cur" : meeting.status === "completed" ? "done" : "todo"}><div className="t">Meeting held</div><div className="d"></div></li>
                <li className={meeting.status === "completed" && meeting.minutes ? "done" : "todo"}><div className="t">MOM issued</div><div className="d"></div></li>
                <li className={meeting.actionPoints.every((a) => a.status === "completed") ? "done" : "todo"}><div className="t">Actions closed</div><div className="d"></div></li>
              </ul>
            </div>
          </div>
          {meeting.attendees.length > 0 ? (
            <div className="card">
              <div className="card-h"><h3>Attendees</h3></div>
              <AttendeesTable rows={meeting.attendees} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
