import { PageHeader, Card, EmptyState, RefreshErrorState, StatusPill } from "@/app/_components/ds";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { getMeeting, getMinutes, getResolutions } from "../../../_data/loaders";
import { fmtDateTime, humanize, meetingPillStatus, meetingStatusLabel, votePillStatus } from "../../../_data/format";
import { MinutesPanel } from "./MinutesPanel";

export const dynamic = "force-dynamic";

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
  textAlign: "left",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};

export default async function MinutesPage({
  params,
}: {
  params: { meetingId: string };
}) {
  const { meetingId } = params;
  const [meeting, minutes, resolutions] = await Promise.all([
    getMeeting(meetingId),
    getMinutes(meetingId),
    getResolutions(meetingId),
  ]);

  const title = meeting.data?.title ? `Minutes — ${meeting.data.title}` : "Minutes";

  // GAP-MEETING-MEETINGS-MEETINGID-MINUTES-05: distinguish "not drafted" (404,
  // or a clean read with no record) from an outage. Only a 404 / clean-null
  // should offer the Create button; an outage must not, to avoid duplicate
  // drafts.
  const notDrafted =
    minutes.status === 404 || (minutes.source === "api" && minutes.data === null);
  const minutesOutage =
    minutes.data === null && minutes.source === "error" && minutes.status !== 404;

  const currentUserId = getSessionUserId();

  // GAP-MEETING-MEETINGS-MEETINGID-MINUTES-06: give the header the meeting's
  // status + scheduled time so the record has context (falls back to the plain
  // title if the meeting fetch failed).
  const meetingData = meeting.data;

  return (
    <>
      <PageHeader
        title={title}
        subtitle="Draft, review and approve the record of the meeting under a maker-checker workflow."
        back={`/meeting/meetings/${meetingId}`}
        backLabel="Console"
      />

      {meetingData && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <StatusPill
            status={meetingPillStatus(meetingData.status)}
            label={meetingStatusLabel(meetingData.status)}
          />
          {meetingData.scheduledAt && (
            <span style={{ fontSize: 13, color: "var(--ink2)", ...monoStyle }}>
              {fmtDateTime(meetingData.scheduledAt)}
            </span>
          )}
          {meetingData.meetingNumber && (
            <span style={{ fontSize: 13, color: "var(--ink2)", ...monoStyle }}>
              {meetingData.meetingNumber}
            </span>
          )}
        </div>
      )}

      <MinutesPanel
        meetingId={meetingId}
        initialMinutes={minutes.data}
        minutesReachable={minutes.source === "api" || minutes.data !== null}
        notDrafted={notDrafted && !minutesOutage}
        currentUserId={currentUserId}
      />

      {/* Vote records for this meeting (Req 11.4) */}
      <Card title={`Vote records (${resolutions.source === "api" ? resolutions.data.length : "—"})`} padding>
        {resolutions.source === "error" ? (
          <RefreshErrorState
            error={{
              what: "We couldn't load the vote records.",
              next: "Check your connection and try again.",
              actions: ["retry", "help"],
            }}
          />
        ) : resolutions.data.length === 0 ? (
          <EmptyState
            icon="🗳️"
            title="No resolutions recorded"
            message="Motions put to a vote in this meeting — and their outcomes — will appear here for the record."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={labelStyle}>No.</th>
                  <th style={labelStyle}>Resolution</th>
                  <th style={labelStyle}>For</th>
                  <th style={labelStyle}>Against</th>
                  <th style={labelStyle}>Abstain</th>
                  <th style={labelStyle}>Result</th>
                </tr>
              </thead>
              <tbody>
                {resolutions.data.map((r) => (
                  <tr key={r.id}>
                    <td style={monoStyle}>{r.resolutionNumber || "—"}</td>
                    <td style={{ maxWidth: 360 }}>{r.text}</td>
                    <td style={monoStyle}>{r.votesFor}</td>
                    <td style={monoStyle}>{r.votesAgainst}</td>
                    <td style={monoStyle}>{r.votesAbstain}</td>
                    <td>
                      <StatusPill status={votePillStatus(r.result)} label={humanize(r.result)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
