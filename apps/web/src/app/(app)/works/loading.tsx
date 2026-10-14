import { SkeletonBar } from "@/app/_components/ds/Skeleton";

/**
 * GAP-WORKS-HOME-04: the hub renders five StatCards and an 8-tile module grid,
 * so the skeleton must mirror both — five stat placeholders in the StatGrid
 * layout and a tile-grid block (auto-fill minmax 220px, matching page.tsx) —
 * instead of four KPI blocks + one tall h-64 bar, which caused a layout jump
 * when the real content landed. Built from the shared token-based ds
 * SkeletonBar (SF-11): no hard-coded colours, dark-mode and reduced-motion safe.
 */
export default function Loading() {
  return (
    <div className="page-main wrap space-y-4" role="status" aria-label="Loading">
      <SkeletonBar w={192} h={32} />
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBar key={i} h={96} style={{ borderRadius: 8 }} />
        ))}
      </div>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBar key={i} h={108} style={{ borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}
