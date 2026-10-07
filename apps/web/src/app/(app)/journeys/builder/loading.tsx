import { SkeletonTable } from "../../../_components/ds";

// GAP-JOURNEYS-HOME-04: table skeleton for the definitions list.
export default function Loading() {
  return (
    <div className="page-main">
      <SkeletonTable rows={6} />
    </div>
  );
}
