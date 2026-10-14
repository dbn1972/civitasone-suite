import { SkeletonBar } from "@/app/_components/ds/Skeleton";

// GAP-CONTRACTS-HOME-03: the /contracts hub is a grid of link tiles
// (ModuleHub), not a data table. This loading state previously drew an
// 8-row table skeleton — the wrong shape for the page it fronts (the table
// skeleton lives in list/loading.tsx, which is correct for /contracts/list).
// Render tile-shaped placeholders that match the real hub layout instead.
function Bar({ w, h, mb, r }: { w: number | string; h: number; mb?: number; r?: number }) {
  return <SkeletonBar w={w} h={h} style={{ marginBottom: mb, borderRadius: r ?? 8 }} />;
}

function Tile() {
  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <SkeletonBar w={42} h={42} style={{ borderRadius: 11 }} />
      <Bar w="55%" h={16} />
      <Bar w="80%" h={12} />
    </div>
  );
}

export default function ContractsLoading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading contracts">
      <div className="ph">
        <div>
          <Bar w={280} h={28} mb={8} />
          <Bar w={360} h={14} />
        </div>
      </div>
      <div className="grid g-3" style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Tile key={i} />
        ))}
      </div>
    </div>
  );
}
