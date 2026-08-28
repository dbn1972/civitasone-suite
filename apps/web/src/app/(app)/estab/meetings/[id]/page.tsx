import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getMeetingById } from "../../../../_data/loaders";
import { PageHeader, RefreshErrorState, StatusPill } from "../../../../_components/ds";
import { ActionPointsTable, AttendeesTable } from "./MeetingDetailTables";
import { MeetingActions } from "./MeetingActions";

export default async function MeetingDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { tab?: string };
}) {
  const { data: meeting, source } = await getMeetingById(params.id);
  const onAgendaTab = searchParams?.tab === "agenda";

  if (!meeting) {
    // Same note as meeting/meetings/[meetingId]/page.tsx: fetchJson folds a
    // real 404 and a transient failure into the same source:"error" signal,
    // so one truthful message + a real retry covers both.
    return (
      <>
        <PageHeader title="Meeting not available" back="/estab/meetings" />
        <RefreshErrorState
          error={{
            what: "This meeting couldn't be loaded.",
            next: "It may not exist, or live data couldn't be reached. Try again, or go back and pick another meeting.",
            actions: ["retry", "back", "help"],
          }}
          backHref="/estab/meetings"
        />
      </>
    );
  }

  return (
    <>
      {source === "error" && (
        <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      )}
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

      <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>
        <Link
          href={`/estab/meetings/${params.id}`}
          role="tab"
          aria-selected={!onAgendaTab}
          className={!onAgendaTab ? "on" : undefined}
        >
          Details
        </Link>
        <Link
          href={`/estab/meetings/${params.id}?tab=agenda`}
          role="tab"
          aria-selected={onAgendaTab}
          className={onAgendaTab ? "on" : undefined}
        >
          Agenda ({meeting.agenda.length})
        </Link>
      </div>

      {onAgendaTab ? (
        <div className="card">
          <div className="card-h">
            <h3>Agenda</h3>
          </div>
          {meeting.agenda.length === 0 ? (
            <p className="sub" style={{ padding: "0 0 16px" }}>
              No agenda items recorded for this meeting yet.
            </p>
          ) : (
            <div className="fields" style={{ padding: "4px 16px 16px" }}>
              {[...meeting.agenda]
                .sort((a, b) => a.itemNo - b.itemNo)
                .map((item) => (
                  <div
                    key={item.id}
                    style={{ padding: "12px 0", borderBottom: "1px solid var(--line2)" }}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <span style={{ fontWeight: 700, color: "var(--ink2)", fontSize: 13 }}>
                        {item.itemNo}.
                      </span>
                      <span style={{ fontWeight: 600 }}>{item.title}</span>
                    </div>
                    {item.description && (
                      <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 4 }}>
                        {item.description}
                      </p>
                    )}
                    {item.decision && (
                      <p style={{ fontSize: 13, marginTop: 4 }}>
                        <strong>Decision:</strong> {item.decision}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      ) : (
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
      )}
    </>
  );
}
