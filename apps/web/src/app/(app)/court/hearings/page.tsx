import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { Card, EmptyState, PageHeader, StatusPill } from "@/app/_components/ds";
import { getCase, getCaseHearings, getCases, getHearings } from "../_data/loaders";
import { CaseSelector } from "../_components/CaseSelector";
import { HearingsConsole } from "./HearingsConsole";
import { fmtDateTime, hearingPillStatus, hearingStatusLabel, humanize } from "../_data/format";
import { todayIST } from "@/lib/formatters";

export const dynamic = "force-dynamic";

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
  textAlign: "start",
};
const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};

export default async function HearingsListPage({
  searchParams,
}: {
  searchParams: { caseId?: string };
}) {
  const caseId = (searchParams.caseId ?? "").trim();
  const casesResult = await getCases();

  const [detailResult, hearingsResult] = caseId
    ? await Promise.all([getCase(caseId), getCaseHearings(caseId)])
    : [null, null];

  // GAP-COURT-HEARINGS-03: with no case selected, show today's hearings across
  // cases (flat read model) instead of a dead "pick a case" page.
  const today = todayIST();
  const dailyResult = caseId ? null : await getHearings({ from: today, to: today });

  return (
    <>
      <PageHeader
        title="Hearings"
        subtitle="Today's cause of hearings across cases — or pick a case to schedule, adjourn, or record the outcome of its hearings."
        back="/court"
        backLabel="Court"
      />

      <Card title="Select a case" padding>
        <CaseSelector
          cases={casesResult.data}
          casesSource={casesResult.source}
          basePath="/court/hearings"
          selectedCaseId={caseId}
        />
      </Card>

      {!caseId ? (
        <Card title={`Today's hearings · ${today}`} padding>
          {dailyResult && dailyResult.source === "error" ? (
            <>
              <DataSourceBadge source="error" />
              <EmptyState
                icon="📅"
                title="Could not load today's hearings"
                message="Live data couldn't be reached. Try again shortly, or pick a case above."
              />
            </>
          ) : !dailyResult || dailyResult.data.length === 0 ? (
            <EmptyState
              icon="📅"
              title="No hearings listed for today"
              message="Nothing is scheduled for today. Pick a case above to schedule one."
            />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th style={labelStyle}>Time</th>
                    <th style={labelStyle}>Purpose</th>
                    <th style={labelStyle}>Status</th>
                    <th style={labelStyle}>Next date</th>
                    <th style={labelStyle}>
                      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
                        Actions
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dailyResult.data.map((h) => (
                    <tr key={h.id}>
                      <td style={mono}>{fmtDateTime(h.scheduledDate)}</td>
                      <td>{h.purpose ? humanize(h.purpose) : "—"}</td>
                      <td>
                        <StatusPill status={hearingPillStatus(h.status)} label={hearingStatusLabel(h.status)} />
                      </td>
                      <td style={mono}>{h.nextDate ?? "—"}</td>
                      <td style={{ textAlign: "end" }}>
                        <Link className="btn ghost sm" href={`/court/hearings?caseId=${encodeURIComponent(h.caseId)}`}>
                          Open case hearings →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : !detailResult || detailResult.source === "error" || !detailResult.data ? (
        <Card padding>
          <DataSourceBadge source="error" />
          <EmptyState
            icon="📅"
            title="Case not available"
            message="This case couldn't be loaded. It may belong to another court, or live data couldn't be reached. Pick another case above."
          />
        </Card>
      ) : (
        <HearingsConsole
          caseId={detailResult.data.id}
          caseSummary={{ title: detailResult.data.title, cnrNumber: detailResult.data.cnrNumber }}
          initialHearings={hearingsResult ? hearingsResult.data : []}
          hearingsSource={hearingsResult ? hearingsResult.source : "error"}
        />
      )}
    </>
  );
}
