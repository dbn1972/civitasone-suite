import { SkeletonTable } from "@/app/_components/ds";

export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading dashboard">
      <SkeletonTable rows={4} />
    </div>
  );
}
