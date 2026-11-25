import { SkeletonBar, SkeletonCard } from "@/app/_components/ds";

export default function Loading() {
  return (
    <div role="status" className="page-main wrap">
      <span className="sr-only">Loading the visit request form…</span>
      <SkeletonBar w={240} h={26} style={{ marginBottom: 18 }} />
      <SkeletonCard />
    </div>
  );
}
