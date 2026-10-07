import { SkeletonCard, SkeletonBar } from "@/app/_components/ds";

/**
 * GAP-LEARNING-ASSESSMENTS-VERIFY-05: a loading state for the verify segment
 * so submitting a token shows a skeleton matching the form + stat grid shape
 * while fetching, instead of relying on the parent assessments skeleton.
 */
export default function Loading() {
  return (
    <div className="space-y-4 p-6" aria-label="Loading" aria-busy="true">
      <SkeletonBar w={220} h={28} />
      <SkeletonBar w="100%" h={64} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
