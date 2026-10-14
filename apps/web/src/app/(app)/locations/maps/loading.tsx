import { SkeletonBar, SkeletonRegion } from "@/app/_components/ds/Skeleton";

/** Header plus a full-height map block, matching the map viewer / monitoring pages. */
export default function Loading() {
  return (
    <SkeletonRegion live className="page-main wrap">
      <SkeletonBar w={120} h={12} style={{ marginBottom: 10 }} />
      <SkeletonBar w={260} h={28} style={{ marginBottom: 20 }} />
      <SkeletonBar h={420} style={{ borderRadius: 12 }} />
    </SkeletonRegion>
  );
}
