import Link from "next/link";
import { PageHeader, StatCard, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { todayIST } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { PrintExportButton } from "../../../_components/PrintExportButton";
import { getLegalDashboard, getLegalHearings } from "../../../_data/loaders";
import { CasesOverviewSeg } from "./CasesOverviewSeg";

type HearingRow = {
  id: string;
  caseNo: string;
  court: string;
  purpose: string;
  status: string;
} & Record<string, unknown>;

export default async function LegalDashboardPage() {
  const [{ data, source }, hearingsRes] = await Promise.all([
    getLegalDashboard(),
    getLegalHearings(),
  ]);

  // GAP-LEGAL-DASHBOARD-03: a failed dashboard fetch must not read as good
  // news (zeros + a fabricated disposal rate). Show an honest retry state.
  if (source === "error") {
    return (
      <div className="wrap">
        <PageHeader title="Legal Management" subtitle="Court cases, hearings, legal opinions & order compliance." />
        <RefreshErrorState
          error={toHumanError("load", { area: "legal dashboard" })}
          backHref="/legal"
        />
      </div>
    );
  }

  // GAP-LEGAL-DASHBOARD-01: disposal rate from real disposed/total counts;
  // "—" when there are no cases, never a hard-coded 64%.
  const disposalRate = data.totalCases > 0 ? Math.round((data.disposedCases / data.totalCases) * 100) : null;

  // GAP-LEGAL-DASHBOARD-02: derive the next few hearings (today IST onward)
  // so the table matches the "N hearings this week" headline.
  const today = todayIST();
  const upcoming: HearingRow[] = (hearingsRes.source === "error" ? [] : hearingsRes.data)
    .filter((h) => h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5)
    .map((h) => ({
      id: h.id,
      caseNo: h.caseNo,
      court: h.court,
      purpose: h.purpose ?? "Hearing",
      status: h.status,
    }));

  return (
    <div className="wrap">
      <PageHeader
        title="Legal Management"
        subtitle="Court cases, hearings, legal opinions & order compliance."
        actions={
          <>
            <PrintExportButton label="Export" documentTitle="Legal Dashboard" />
            <Link href="/legal/cases/new" className="btn primary">+ New Case</Link>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📁" iconBg="var(--line2)" label="Active Cases" value={data.activeCases} />
        <StatCard icon="🗓️" iconBg="var(--infobg)" label="Hearings (wk)" value={data.hearingsThisWeek} />
        <StatCard icon="📜" iconBg="var(--warnbg)" label="Orders to Comply" value={data.ordersPending} />
        {/* GAP-LEGAL-DASHBOARD-04: this value is a workload count (opinions
            due), not a litigation-risk measure — label it honestly. */}
        <StatCard icon="📝" iconBg="var(--infobg)" label="Opinions Due" value={data.opinionsDue} />
      </div>
      <div className="grid g-main" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <CasesOverviewSeg
            activeCases={data.activeCases}
            hearingsThisWeek={data.hearingsThisWeek}
            ordersPending={data.ordersPending}
          />
          <div className="card">
            <div className="card-h">
              <h3>Upcoming hearings</h3>
              <Link className="lnk" href="/legal/hearings">View all hearings</Link>
            </div>
            <p className="pad" style={{ color: "var(--mut)", fontSize: 13, margin: 0 }}>
              {data.hearingsThisWeek > 0 ? `${data.hearingsThisWeek} hearings scheduled this week.` : "No hearings scheduled this week."}
            </p>
            {upcoming.length > 0 ? (
              <DataTable<HearingRow>
                columns={[
                  { key: "caseNo", label: "Case" },
                  { key: "court", label: "Court" },
                  { key: "purpose", label: "Purpose" },
                  { key: "status", label: "Status", cellType: "status" },
                ]}
                rows={upcoming}
              />
            ) : (
              <EmptyState
                icon="🗓️"
                title="No upcoming hearings"
                message="Scheduled hearings will appear here."
              />
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Disposal rate</h3></div>
            <div className="pad" style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ fontSize: 36, fontWeight: 800 }}>
                {disposalRate === null ? "—" : `${disposalRate}%`}
              </div>
              <div style={{ fontSize: 12, color: "var(--mut)" }}>
                {disposalRate === null ? "no cases yet" : `${data.disposedCases} of ${data.totalCases} cases disposed`}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Action needed</h3><span className="pill warn">{data.ordersPending}</span></div>
            <div className="pad" style={{ color: "var(--mut)", fontSize: 13 }}>
              {data.ordersPending} court orders require compliance action.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
