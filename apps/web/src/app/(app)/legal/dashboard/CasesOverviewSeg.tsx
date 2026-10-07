"use client";

/**
 * Cases overview card — previously had a decorative scope selector (All /
 * High Court / Tribunals) that only changed a bold label while the numbers
 * stayed the same (GAP-LEGAL-DASHBOARD-05). Removed until a scoped-count
 * backend exists. The numbers now render as a simple stats sentence with
 * token colours (GAP-LEGAL-DASHBOARD-06).
 */
export function CasesOverviewSeg({
  activeCases,
  hearingsThisWeek,
  ordersPending,
}: {
  activeCases: number;
  hearingsThisWeek: number;
  ordersPending: number;
}) {
  return (
    <div className="card">
      <div className="card-h">
        <h3>Cases overview</h3>
      </div>
      <div className="pad" style={{ color: "var(--ink2)", fontSize: 13, display: "flex", gap: 18 }}>
        <span><strong>{activeCases}</strong> active cases</span>
        <span><strong>{hearingsThisWeek}</strong> hearings this week</span>
        <span><strong>{ordersPending}</strong> orders pending</span>
      </div>
    </div>
  );
}
