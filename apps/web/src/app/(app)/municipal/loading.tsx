import { SkeletonCard, TileHubSkeleton } from "@/app/_components/ds";

// GAP-MUNICIPAL-HOME-05: skeleton for the municipal hub while its
// (force-dynamic) data resolves. Mirrors the loaded layout — a stat row of 3
// cards above the tile sections — using DS shimmer primitives that follow the
// theme.
export default function MunicipalLoading() {
  return (
    <div aria-busy="true" aria-label="Loading municipal services…" style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <TileHubSkeleton sections={2} tilesPerSection={6} />
    </div>
  );
}
