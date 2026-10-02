/**
 * GAP-ASSETS-HOME-03: header + tile-grid skeleton (matches the hub and works as
 * a generic card skeleton for child routes without their own loading.tsx).
 * No min-h-screen wrapper, so there is no layout jump when content lands.
 */
export default function AssetsLoading() {
  const bar = { borderRadius: 8, background: "var(--line, #e2e8f0)" } as const;
  return (
    <div className="animate-pulse page-main" role="status" aria-label="Loading assets" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ ...bar, height: 14, width: 160 }} />
      <div style={{ ...bar, height: 32, width: 280 }} />
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ ...bar, height: 88, borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}
