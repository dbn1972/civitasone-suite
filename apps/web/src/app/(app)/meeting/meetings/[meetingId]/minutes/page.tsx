import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, EmptyState, StatusPill } from "@/app/_components/ds";
import { getMeeting, getMinutes, getResolutions } from "../../../_data/loaders";
import { humanize, votePillStatus } from "../../../_data/format";
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
  // getMinutes returns source:"error" both on a real failure AND on a 404 (no
  // minutes drafted yet). We treat a null payload as "not yet drafted" and let
  // the panel offer to create the draft, rather than showing a hard error.

  return (
    <>
      <PageHeader
        title={title}
        subtitle="Draft, review and approve the record of the meeting under a maker-checker workflow."
        back={`/meeting/meetings/${meetingId}`}
        backLabel="Console"
      />

      <MinutesPanel
        meetingId={meetingId}
        initialMinutes={minutes.data}
        minutesReachable={minutes.source === "api" || minutes.data !== null}
      />

      {/* Vote records for this meeting (Req 11.4) */}
      <Card title={`Vote records (${resolutions.source === "api" ? resolutions.data.length : "—"})`} padding>
        {resolutions.source === "error" ? (
          <DataSourceBadge source="error" />
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
