/** GAP-ASSETS-FLEET-03: card-grid skeleton for the fleet hub (now that it fetches). */
export default function Loading() {
  const bar = { borderRadius: 8, background: "var(--line, #e2e8f0)" } as const;
  return (
    <div className="page-main wrap animate-pulse" role="status" aria-label="Loading fleet overview" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ ...bar, height: 14, width: 160 }} />
      <div style={{ ...bar, height: 32, width: 280 }} />
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ ...bar, height: 150, borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}
