import { PageHeader, StatGrid, StatCard, StatusPill, Card, DataTable } from "@/app/_components/ds";

export default function SchemeDetailPage({ params }: { params: { id: string } }) {
  const scheme = {
    name: "PM Gram Sadak Yojana",
    sanctioned: "₹2,500 Cr",
    released: "₹1,800 Cr",
    spent: "₹1,520 Cr",
    spentPercent: "84%",
    status: "active",
    ministry: "Ministry of Rural Development",
    startDate: "01-Apr-2024",
    endDate: "31-Mar-2026",
  };

  type Milestone = { milestone: string; target: string; achieved: string; status: string; [k: string]: unknown };
  const milestones: Milestone[] = [
    { milestone: "Phase 1 — DPR Preparation", target: "30-Jun-2024", achieved: "28-Jun-2024", status: "approved" },
    { milestone: "Phase 2 — Tendering", target: "30-Sep-2024", achieved: "15-Oct-2024", status: "approved" },
    { milestone: "Phase 3 — Construction Start", target: "01-Nov-2024", achieved: "15-Nov-2024", status: "active" },
    { milestone: "Phase 4 — Mid-term Review", target: "31-Mar-2025", achieved: "—", status: "pending" },
    { milestone: "Phase 5 — Completion", target: "31-Mar-2026", achieved: "—", status: "pending" },
  ];

  type Release = { releaseNo: string; date: string; amount: string; ucStatus: string; [k: string]: unknown };
  const releases: Release[] = [
    { releaseNo: "REL/2024/001", date: "15-Apr-2024", amount: "₹600 Cr", ucStatus: "approved" },
    { releaseNo: "REL/2024/002", date: "01-Jul-2024", amount: "₹500 Cr", ucStatus: "approved" },
    { releaseNo: "REL/2024/003", date: "01-Oct-2024", amount: "₹400 Cr", ucStatus: "pending" },
    { releaseNo: "REL/2025/001", date: "05-Jan-2025", amount: "₹300 Cr", ucStatus: "pending" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={scheme.name} subtitle={scheme.ministry} back="/finance/expenditure/scheme-tracking" />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label="Sanctioned" value={scheme.sanctioned} />
        <StatCard icon="📤" iconBg="#e7edfd" label="Released" value={scheme.released} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Spent" value={scheme.spent} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Utilization" value={scheme.spentPercent} />
      </StatGrid>

      <Card title="Scheme Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Scheme</span><span>{scheme.name}</span></div>
          <div className="field"><span className="label">Ministry</span><span>{scheme.ministry}</span></div>
          <div className="field"><span className="label">Duration</span><span>{scheme.startDate} to {scheme.endDate}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={scheme.status} /></div>
        </div>
      </Card>

      <Card title="Milestones">
        <DataTable<Milestone>
          columns={[
            { key: "milestone", label: "Milestone" },
            { key: "target", label: "Target Date" },
            { key: "achieved", label: "Achieved" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={milestones}
        />
      </Card>

      <Card title="Fund Releases & UC Status">
        <DataTable<Release>
          columns={[
            { key: "releaseNo", label: "Release No" },
            { key: "date", label: "Date" },
            { key: "amount", label: "Amount", align: "right" },
            { key: "ucStatus", label: "UC Status", cellType: "status" },
          ]}
          rows={releases}
        />
      </Card>
    </main>
  );
}
