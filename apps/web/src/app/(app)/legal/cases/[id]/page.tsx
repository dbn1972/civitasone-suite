import Link from "next/link";
import { notFound } from "next/navigation";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatusPill, DataTable, EmptyState } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { getLegalCaseById } from "../../../../_data/loaders";
import { CaseActions } from "./CaseActions";

type HearingRow = {
  id: string;
  date: string;
  stage: string;
  outcome: string;
  notes: string;
} & Record<string, unknown>;

type OrderRow = {
  id: string;
  orderType: string;
  orderDate: string;
  summary: string;
} & Record<string, unknown>;

/** Map a case status to a lifecycle stage index (0-based, for 4-stage pipeline). */
function stageIndex(status: string): number {
  switch (status) {
    case "pending":
      return 1; // Filed, in progress
    case "appealed":
    case "stayed":
      return 2; // Arguments / stay order stage
    case "disposed":
    case "settled":
      return 3; // Judgment rendered
    default:
      return 0; // Registered only
  }
}

function tliClass(itemIndex: number, currentIndex: number): "done" | "cur" | "todo" {
  if (itemIndex < currentIndex) return "done";
  if (itemIndex === currentIndex) return "cur";
  return "todo";
}

export default async function LegalCaseDetailPage({ params }: { params: { id: string } }) {
  const { data: caseData, source } = await getLegalCaseById(params.id);

  if (!caseData) {
    notFound();
  }

  const statusLabel =
    caseData.status === "pending"
      ? "Pending"
      : caseData.status === "disposed"
      ? "Disposed"
      : caseData.status === "stayed"
      ? "Stayed"
      : caseData.status === "appealed"
      ? "Appealed"
      : caseData.status === "settled"
      ? "Settled"
      : caseData.status;

  const hearingRows: HearingRow[] = (caseData.hearings ?? []).map((h) => ({
    id: h.id,
    date: formatIndianDate(h.date),
    stage: h.purpose ?? "Hearing",
    outcome: h.outcome ?? "—",
    notes: h.nextDate ? `Next: ${formatIndianDate(h.nextDate)}` : "—",
  }));

  const orderRows: OrderRow[] = (caseData.orders ?? []).map((o) => ({
    id: o.id,
    orderType: o.orderNo ? `Order ${o.orderNo}` : "Court order",
    orderDate: formatIndianDate(o.date),
    summary: o.summary,
  }));

  const STAGES = ["Registered", "Filed", "Arguments", "Judgment"] as const;
  const curStage = stageIndex(caseData.status);

  return (
    <main className="wrap">
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}
      >
        <Link href="/legal" className="lnk">Legal</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "#cdd2dc" }}>/</span>
        <Link href="/legal/list" className="lnk">Cases</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "#cdd2dc" }}>/</span>
        <span aria-current="page">{caseData.caseNo}</span>
      </nav>

      <PageHeader
        back="/legal/list"
        title={`${caseData.caseNo} — ${caseData.court}`}
        actions={<CaseActions caseId={caseData.id} />}
      />

      {source === "error" && <DataSourceBadge source={source} />}

      <div className="grid g-main" style={{ alignItems: "start" }}>
        {/* ── Left column ──────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Details card */}
          <div className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Case no.</div><div className="v"><span className="mono">{caseData.caseNo}</span></div></div>
              <div className="fld"><div className="l">Court</div><div className="v">{caseData.court}</div></div>
              <div className="fld"><div className="l">Subject</div><div className="v">{caseData.type}</div></div>
              {caseData.petitioner && (
                <div className="fld"><div className="l">Petitioner</div><div className="v">{caseData.petitioner}</div></div>
              )}
              {caseData.respondent && (
                <div className="fld"><div className="l">Respondent</div><div className="v">{caseData.respondent}</div></div>
              )}
              {caseData.description && (
                <div className="fld"><div className="l">Description</div><div className="v">{caseData.description}</div></div>
              )}
              <div className="fld">
                <div className="l">Status</div>
                <div className="v"><StatusPill status={caseData.status} label={statusLabel} /></div>
              </div>
              <div className="fld"><div className="l">Raised date</div><div className="v">{formatIndianDate(caseData.filedDate)}</div></div>
              {caseData.nextHearingDate && (
                <div className="fld"><div className="l">Next hearing</div><div className="v">{formatIndianDate(caseData.nextHearingDate)}</div></div>
              )}
              {caseData.advocateName && (
                <div className="fld"><div className="l">Counsel ref</div><div className="v">{caseData.advocateName}</div></div>
              )}
              {caseData.department && (
                <div className="fld"><div className="l">Department</div><div className="v">{caseData.department}</div></div>
              )}
            </div>
          </div>

          {/* Case diary */}
          <div className="card">
            <div className="card-h"><h3>Case diary</h3></div>
            {hearingRows.length > 0 ? (
              <DataTable<HearingRow>
                columns={[
                  { key: "date", label: "Date" },
                  { key: "stage", label: "Stage" },
                  { key: "outcome", label: "Outcome" },
                  { key: "notes", label: "Notes" },
                ]}
                rows={hearingRows}
              />
            ) : (
              <EmptyState
                icon="📅"
                title="No hearing records"
                message="Add hearing records via the Hearings section."
              />
            )}
          </div>

          {/* Court orders */}
          <div className="card">
            <div className="card-h"><h3>Court orders</h3></div>
            {orderRows.length > 0 ? (
              <DataTable<OrderRow>
                columns={[
                  { key: "orderType", label: "Order type" },
                  { key: "orderDate", label: "Order date" },
                  { key: "summary", label: "Summary" },
                ]}
                rows={orderRows}
              />
            ) : (
              <EmptyState
                icon="⚖️"
                title="No court orders"
                message="Court orders issued against this case will appear here."
              />
            )}
          </div>
        </div>

        {/* ── Right column: lifecycle timeline ──────────── */}
        <div className="card">
          <div className="card-h"><h3>Lifecycle</h3></div>
          <div className="pad">
            <ul className="tl">
              {STAGES.map((label, i) => (
                <li key={label} className={tliClass(i, curStage)}>
                  <div className="t">{label}</div>
                  <div className="d">
                    {i === 0 ? formatIndianDate(caseData.filedDate) : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
