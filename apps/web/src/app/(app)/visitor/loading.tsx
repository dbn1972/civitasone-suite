import { SkeletonCard, SkeletonBar } from "@/app/_components/ds";

/**
 * GAP-VISITOR-HOME-05: mirror the loaded layout (3 stat cards + 3 console
 * tiles) and announce loading to assistive tech via role="status" + a
 * visually-hidden label (an aria-label on a plain div is not announced).
 */
export default function Loading() {
  return (
    <div role="status" className="page-main wrap">
      <span className="sr-only">Loading visitor management…</span>
      <SkeletonBar w={240} h={26} style={{ marginBottom: 18 }} />
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(3,1fr)", marginBottom: 18 }}>
        {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
      </div>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
        {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}
