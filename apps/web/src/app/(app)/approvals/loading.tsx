export default function ApprovalsLoading() {
  return (
    <div className="skeleton-page">
      <div className="skeleton-header" style={{ height: 32, width: 200, marginBottom: 8 }} />
      <div className="skeleton-sub" style={{ height: 16, width: 340, marginBottom: 24 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton-card" style={{ height: 80, borderRadius: 8 }} />
        ))}
      </div>
      <div className="skeleton-table" style={{ height: 400, borderRadius: 8 }} />
    </div>
  );
}
