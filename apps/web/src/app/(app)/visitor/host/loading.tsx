import { SkeletonCard, SkeletonTable, SkeletonBar } from "@/app/_components/ds";

/** GAP-VISITOR-HOME-05: host portal loading mirror (stats + expected table). */
export default function Loading() {
  return (
    <div role="status" className="page-main wrap">
      <span className="sr-only">Loading the host portal…</span>
      <SkeletonBar w={200} h={26} style={{ marginBottom: 18 }} />
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(3,1fr)", marginBottom: 18 }}>
        {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
      </div>
      <SkeletonTable rows={4} />
    </div>
  );
}
