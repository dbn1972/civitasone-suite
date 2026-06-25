import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatusPill, DataTable } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { getLegalCaseById } from "../../../../_data/loaders";
import { CaseActions } from "./CaseActions";

export default async function LegalCaseDetailPage({ params }: { params: { id: string } }) {
  const { data: caseData, source } = await getLegalCaseById(params.id);

  if (!caseData) {
    return (
      <div className="wrap">
        <Link href="/legal/list" className="back">← Back</Link>
        <p style={{ color: "#667085", marginTop: 16 }}>Case not found.</p>
      </div>
    );
  }

  const statusLabel = caseData.status === "active" ? "Pending"
    : caseData.status === "disposed" ? "Disposed"
    : caseData.status === "stayed" ? "Stayed"
    : caseData.status;

  return (
    <div className="wrap">
      <PageHeader
        back="/legal/list"
        title={`${caseData.caseNo} · ${caseData.title}`}
        actions={<CaseActions caseId={params.id} />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Status</div><div className="v"><StatusPill status={caseData.status} label={statusLabel} /></div></div>
              <div className="fld"><div className="l">Court</div><div className="v">{caseData.court}</div></div>
              <div className="fld"><div className="l">Subject</div><div className="v">{caseData.type}{caseData.description ? ` — ${caseData.description.slice(0, 80)}` : ""}</div></div>
              {caseData.petitioner && <div className="fld"><div className="l">Petitioner</div><div className="v">{caseData.petitioner}</div></div>}
              {caseData.respondent && <div className="fld"><div className="l">Respondent</div><div className="v">{caseData.respondent}</div></div>}
              {caseData.advocateName && <div className="fld"><div className="l">Counsel</div><div className="v">{caseData.advocateName}</div></div>}
              {caseData.nextHearingDate && <div className="fld"><div className="l">Next hearing</div><div className="v">{formatIndianDate(caseData.nextHearingDate)}</div></div>}
              {caseData.department && <div className="fld"><div className="l">Department</div><div className="v">{caseData.department}</div></div>}
              <div className="fld"><div className="l">Filed</div><div className="v">{formatIndianDate(caseData.filedDate)}</div></div>
            </div>
          </div>
          {caseData.hearings.length > 0 && (
            <div className="card">
              <div className="card-h"><h3>Case events</h3></div>
              <DataTable
                columns={[
                  { key: "date", label: "Date" },
                  { key: "event", label: "Event" },
                  { key: "note", label: "Note" },
                ]}
                rows={caseData.hearings.map((h) => ({
                  id: h.id,
                  date: formatIndianDate(h.date),
                  event: h.purpose ?? "Hearing",
                  note: h.outcome ?? "—",
                }))}
              />
            </div>
          )}
          {caseData.orders.length > 0 && (
            <div className="card">
              <div className="card-h"><h3>Court orders</h3></div>
              <DataTable
                columns={[
                  { key: "date", label: "Date" },
                  { key: "summary", label: "Summary" },
                  { key: "deadline", label: "Deadline" },
                  { key: "status", label: "Status", cellType: "status" },
                ]}
                rows={caseData.orders.map((o) => ({
                  id: o.id,
                  date: formatIndianDate(o.date),
                  summary: o.summary,
                  deadline: o.complianceDeadline ? formatIndianDate(o.complianceDeadline) : "—",
                  status: o.status,
                }))}
              />
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-h"><h3>Workflow</h3></div>
          <div className="pad">
            <ul className="tl">
              <li className="done"><div className="t">Filed</div><div className="d">{formatIndianDate(caseData.filedDate)}</div></li>
              <li className={caseData.hearings.length > 0 ? "done" : "cur"}><div className="t">Notice issued</div><div className="d"></div></li>
              <li className={caseData.hearings.length > 1 ? "cur" : "todo"}><div className="t">Counter-affidavit</div><div className="d"></div></li>
              <li className="todo"><div className="t">Arguments</div><div className="d"></div></li>
              <li className="todo"><div className="t">Judgment</div><div className="d"></div></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
