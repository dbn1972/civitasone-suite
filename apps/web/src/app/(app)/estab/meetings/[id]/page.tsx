import Link from "next/link";
import { getMeetingById } from "../../../../_data/loaders";
import { PageHeader, RefreshErrorState, StatusPill } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { ActionPointsTable, AttendeesTable } from "./MeetingDetailTables";
import { MeetingActions } from "./MeetingActions";
import { MeetingTimeline } from "./MeetingTimeline";
import { getTranslations } from "next-intl/server";

export default async function MeetingDetailPage(
  props: {
    params: Promise<{ id: string }>;
    searchParams?: Promise<{ tab?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const t = await getTranslations("estabW2");
  const { data: meeting, source } = await getMeetingById(params.id);
  const onAgendaTab = searchParams?.tab === "agenda";

  if (source === "error" || !meeting) {
    // Same note as meeting/meetings/[meetingId]/page.tsx: fetchJson folds a
    // real 404 and a transient failure into the same source:"error" signal
    // (getMeetingById's empty value is `null`, so source==="error" always
    // implies !meeting already) — one truthful message + a real retry
    // covers both, and everything below this point can now rely on
    // `meeting` being real, loaded data, not a masked failure (UX-013).
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
      {/* GAP-ESTAB-MEETINGS-DETAIL-05: the shared PageHeader carries the title, status and actions. */}
      <PageHeader
        title={<>{meeting.title}{" "}<StatusPill status={meeting.status.replace(/_/g, " ")} label={meeting.status.replace(/_/g, " ")} /></>}
        back="/estab/meetings"
        actions={<MeetingActions meetingId={params.id} />}
      />
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
              <div className="fld"><div className="l">Date</div><div className="v">{formatIndianDate(meeting.scheduledDate)}{meeting.scheduledTime ? ` · ${meeting.scheduledTime}` : ""}</div></div>
              <div className="fld"><div className="l">Venue</div><div className="v">{meeting.venue ?? "—"}</div></div>
              <div className="fld"><div className="l">Chair</div><div className="v">{meeting.chairperson ?? "—"}</div></div>
              <div className="fld"><div className="l">Attendees</div><div className="v">{meeting.attendeesCount}</div></div>
              <div className="fld"><div className="l">Agenda items</div><div className="v">{meeting.agenda.length}</div></div>
              <div className="fld"><div className="l">MOM</div><div className="v">{
                meeting.minutes ? "Captured"
                  : meeting.status === "scheduled" ? "Not yet held"
                    : meeting.status === "cancelled" ? "—"
                      : "Pending"
              }</div></div>
            </div>
          </div>
          {meeting.minutes ? (
            <div className="card">
              <div className="card-h"><h3>Minutes</h3></div>
              <div className="pad"><p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{meeting.minutes}</p></div>
            </div>
          ) : null}
          {meeting.actionPoints.length > 0 ? (
            <div className="card">
              <div className="card-h"><h3>Action items (MOM)</h3></div>
              <ActionPointsTable rows={meeting.actionPoints} />
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>{t("meetingWorkflowHeading")}</h3></div>
            <div className="pad">
              <MeetingTimeline
                status={meeting.status}
                scheduledDate={meeting.scheduledDate ? formatIndianDate(meeting.scheduledDate) : ""}
                hasMinutes={Boolean(meeting.minutes)}
                actionPointStatuses={meeting.actionPoints.map((a) => a.status)}
                labels={{
                  scheduled: t("tlScheduled"),
                  agendaCirculated: t("tlAgendaCirculated"),
                  held: t("tlHeld"),
                  momIssued: t("tlMomIssued"),
                  actionsClosed: t("tlActionsClosed"),
                }}
              />
              {/* The service keeps a status, not an event log: say so rather than imply recorded events. */}
              <p className="sub" style={{ marginTop: 10, fontSize: 12 }}>{t("meetingStageNote")}</p>
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
