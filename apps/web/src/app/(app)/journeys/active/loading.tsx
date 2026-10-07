import { SkeletonTable } from "../../../_components/ds";

// GAP-JOURNEYS-HOME-04: the table-shaped sub-pages show a table skeleton,
// distinct from the hub's tile skeleton.
export default function Loading() {
  return (
    <div className="page-main">
      <SkeletonTable rows={6} />
    </div>
  );
}
