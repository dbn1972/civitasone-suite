import { PageHeader, SkeletonCard, SkeletonTable } from "../../../_components/ds";

export default function HRDashboardLoading() {
  return (
    <>
      <PageHeader title="HR Dashboard" subtitle="People operations overview." />
      {/* KPI strip skeleton — 6 cards matching HRKPIStrip layout */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
      {/* Action inbox + chart skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <SkeletonTable rows={5} />
        <SkeletonCard />
      </div>
    </>
  );
}
