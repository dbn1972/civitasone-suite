import { SkeletonBar, SkeletonTable } from "../../../_components/ds/Skeleton";

// GAP-CDP-PROFILES-05: heading now matches the loaded page title ("CDP —
// Profiles", page.tsx) so it does not flicker on load, and the skeleton uses
// the design-system Skeleton (theme tokens) instead of hard-coded #f1f5f9. The
// profiles page does render four StatCards above a table, so SkeletonTable
// (4 stat cards + filter bar + table) is the faithful mirror here.
export default function Loading() {
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <div className="ph">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SkeletonBar w={200} h={28} />
          <SkeletonBar w={360} h={14} />
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <SkeletonTable rows={8} />
      </div>
    </div>
  );
}
