/**
 * GAP-WORKS-HOME-04: the hub renders five StatCards and an 8-tile module grid,
 * so the skeleton must mirror both — five stat placeholders in the StatGrid
 * layout and a tile-grid block (auto-fill minmax 220px, matching page.tsx) —
 * instead of four KPI blocks + one tall h-64 bar, which caused a layout jump
 * when the real content landed.
 */
export default function Loading() {
  const bar = { borderRadius: 8, background: "var(--surface2,#f1f5f9)" } as const;
  return (
    <div className="page-main wrap space-y-4" role="status" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded" style={{ background: "var(--border,#e2e8f0)" }} />
      <div
        className="animate-pulse"
        style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ ...bar, height: 96 }} />
        ))}
      </div>
      <div
        className="animate-pulse"
        style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{ ...bar, height: 108, borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}
