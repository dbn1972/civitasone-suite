export default function Loading() {
  return (
    <main className="page-main wrap" aria-busy="true" aria-label="Loading ML Insights">
      <div className="skeleton-pulse" style={{ height: 32, width: "40%", marginBottom: 8 }} />
      <div className="skeleton-pulse" style={{ height: 16, width: "60%", marginBottom: 24 }} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton-pulse" style={{ height: 80, borderRadius: 8 }} />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-pulse" style={{ height: 160, borderRadius: 8 }} />
        ))}
      </div>
    </main>
  );
}
