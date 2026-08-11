export default function Loading() {
  return (
    <div className="page-main wrap" aria-label="Loading…" aria-busy="true">
      <div className="skeleton-block" style={{ height: 48, maxWidth: 400, borderRadius: 8, margin: "24px 0 8px" }} />
      <div className="skeleton-block" style={{ height: 20, maxWidth: 260, borderRadius: 4, marginBottom: 24 }} />
      <div className="skeleton-block" style={{ height: 120, borderRadius: 10, marginBottom: 12 }} />
      <div className="skeleton-block" style={{ height: 300, borderRadius: 10 }} />
    </div>
  );
}
