import { SkeletonBar, SkeletonCard } from "@/app/_components/ds";

/**
 * Segment-level fallback for every /inventory route. GAP-INVENTORY-HOME-04: it
 * used to draw four stat cards the hub does not have, so it is now a neutral
 * shape every inventory page fits -- header, a content card, and a tile grid.
 * Routes whose layout differs add their own loading.tsx (see [id]/loading.tsx).
 */
export default function InventoryLoading() {
  return (
    <div className="page-main" aria-busy="true" aria-label="Loading inventory">
      <SkeletonBar w={160} h={14} />
      <SkeletonBar w={260} h={30} style={{ margin: "10px 0 20px" }} />
      <SkeletonCard />
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16, marginTop: 20 }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBar key={i} w="100%" h={96} />
        ))}
      </div>
    </div>
  );
}
