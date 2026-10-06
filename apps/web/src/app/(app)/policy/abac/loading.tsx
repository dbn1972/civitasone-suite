import { SkeletonTable } from "@/app/_components/ds";

/** GAP-POLICY-HOME-03: table skeleton instead of a bare paragraph. */
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading ABAC rules">
      <SkeletonTable rows={6} />
    </div>
  );
}
