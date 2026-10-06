import { SkeletonCard, SkeletonBar } from "@/app/_components/ds";

/** GAP-VISITOR-HOME-05: admin config loading mirror (presets + policy groups). */
export default function Loading() {
  return (
    <div role="status" className="page-main wrap">
      <span className="sr-only">Loading visitor configuration…</span>
      <SkeletonBar w={220} h={26} style={{ marginBottom: 18 }} />
      <div style={{ display: "grid", gap: 16 }}>
        {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}
