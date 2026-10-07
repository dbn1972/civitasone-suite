import { SkeletonBar, SkeletonCard } from "../../../../_components/ds";

export default function Loading() {
  return (
    <div className="page-main" aria-busy="true" aria-label="Loading service details…">
      <div className="ph" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SkeletonBar w={220} h={28} />
          <SkeletonBar w={320} h={14} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
