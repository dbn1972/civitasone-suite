import { StatGrid } from "../../_components/ds";

export default function ApprovalsLoading() {
  return (
    <div className="skeleton-page">
      <div className="skeleton-header" style={{ height: 32, width: 200, marginBottom: 8 }} />
      <div className="skeleton-sub" style={{ height: 16, width: 340, marginBottom: 24 }} />
      {/* GAP-APPROVALS-HOME-08: reuse the StatGrid design-system wrapper (the
          same responsive `.grid.g-4` the real page uses) instead of a fixed
          inline repeat(4,1fr) that never collapsed on mobile, so the skeleton
          and the loaded page share one column layout at every width. */}
      <div style={{ marginBottom: 24 }}>
        <StatGrid>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-card" style={{ height: 80, borderRadius: 8 }} />
          ))}
        </StatGrid>
      </div>
      <div className="skeleton-table" style={{ height: 400, borderRadius: 8 }} />
    </div>
  );
}
