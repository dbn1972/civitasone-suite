import { SkeletonTable } from "../../../_components/ds";

// GAP-JOURNEYS-HOME-04: analytics shows stat cards + a chart block; the full
// SkeletonTable already leads with four stat-card placeholders, which matches
// the StatGrid at the top of the analytics view.
export default function Loading() {
  return (
    <div className="page-main">
      <SkeletonTable rows={4} />
    </div>
  );
}
