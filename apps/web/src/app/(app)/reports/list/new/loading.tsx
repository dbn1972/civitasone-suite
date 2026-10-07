import { SkeletonBar } from "@/app/_components/ds";

// GAP-REPORTS-LIST-NEW-05: without its own loading.tsx this segment inherited
// the parent list/loading.tsx, which draws a stat-row + table skeleton that
// looks nothing like the create form. A small form-shaped fallback (header +
// two field rows + a button), built from the token-based SkeletonBar so it
// respects dark mode.
export default function NewReportLoading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading…">
      <div className="animate-pulse" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 820 }}>
        <SkeletonBar w={200} h={28} />
        <SkeletonBar w={320} h={14} />
        <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <SkeletonBar w="100%" h={44} />
          <SkeletonBar w="60%" h={44} />
          <SkeletonBar w={140} h={44} />
        </div>
      </div>
    </div>
  );
}
