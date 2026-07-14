import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, EmptyState, StatusPill } from "@/app/_components/ds";
import { getCases } from "../_data/loaders";
import { casePillStatus, fmtDate, humanize } from "../_data/format";

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

export default async function CasesListPage() {
  const cases = await getCases();
  const source = cases.source;

  return (
    <>
      <PageHeader
        title="Case Registry"
        subtitle="Every registered matter. Open a case to see parties, drive its lifecycle, schedule hearings and issue orders."
        back="/court"
        backLabel="Court"
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <Card title={`All cases (${cases.data.length})`} padding>
        {source === "error" ? (
          <EmptyState
            icon="🗂️"
            title="Could not load cases"
            message="Live data couldn't be reached. Try again shortly."
          />
        ) : cases.data.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="No cases yet"
            message="Matters registered by the filing counter will appear here."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={labelStyle}>Case</th>
                  <th style={labelStyle}>Type</th>
                  <th style={labelStyle}>Filed</th>
                  <th style={labelStyle}>SLA target</th>
                  <th style={labelStyle}>Status</th>
                  <th style={labelStyle} />
                </tr>
              </thead>
              <tbody>
                {cases.data.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.title || "Untitled matter"}</div>
                      {c.cnrNumber && (
                        <div style={{ ...monoStyle, fontSize: 12, color: "var(--ink2)" }}>
                          {c.cnrNumber}
                        </div>
                      )}
                    </td>
                    <td>{humanize(c.caseType)}</td>
                    <td style={monoStyle}>{fmtDate(c.filingDate)}</td>
                    <td style={monoStyle}>{fmtDate(c.targetDisposalDate)}</td>
                    <td>
                      <StatusPill status={casePillStatus(c.status)} label={humanize(c.status)} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link className="btn ghost sm" href={`/court/cases/${c.id}`}>
                        Open case →
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
