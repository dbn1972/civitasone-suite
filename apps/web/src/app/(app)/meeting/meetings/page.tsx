import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, EmptyState, StatusPill } from "@/app/_components/ds";
import { getMeetings } from "../_data/loaders";
import { fmtDateTime, humanize, meetingPillStatus } from "../_data/format";

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

export default async function MeetingsListPage() {
  const meetings = await getMeetings();
  const source = meetings.source;

  return (
    <>
      <PageHeader
        title="Meetings"
        subtitle="Every convened meeting. Open one to run the live console — agenda, attendance, quorum and voting."
        back="/meeting"
        backLabel="Meeting"
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <Card title={`All meetings (${meetings.data.length})`} padding>
        {source === "error" ? (
          <EmptyState
            icon="🗂️"
            title="Could not load meetings"
            message="Live data couldn't be reached. Try again shortly."
          />
        ) : meetings.data.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="No meetings yet"
            message="Meetings convened by the secretariat will appear here."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={labelStyle}>Meeting</th>
                  <th style={labelStyle}>Type</th>
                  <th style={labelStyle}>Scheduled</th>
                  <th style={labelStyle}>Quorum</th>
                  <th style={labelStyle}>Status</th>
                  <th style={labelStyle} />
                </tr>
              </thead>
              <tbody>
                {meetings.data.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{m.title || "Untitled meeting"}</div>
                      {m.meetingNumber && (
                        <div style={{ ...monoStyle, fontSize: 12, color: "var(--ink2)" }}>
                          {m.meetingNumber}
                        </div>
                      )}
                    </td>
                    <td>{humanize(m.type)}</td>
                    <td style={monoStyle}>{fmtDateTime(m.scheduledAt)}</td>
                    <td>
                      {m.quorumEstablished ? (
                        <StatusPill status="active" label="Established" />
                      ) : (
                        <span style={{ color: "var(--ink2)" }}>Not yet</span>
                      )}
                    </td>
                    <td>
                      <StatusPill status={meetingPillStatus(m.status)} label={humanize(m.status)} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link className="btn ghost sm" href={`/meeting/meetings/${m.id}`}>
                        Open console →
                      </Link>
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
