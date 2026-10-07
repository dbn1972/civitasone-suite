import { SkeletonCard, SkeletonBar } from "@/app/_components/ds";

/**
 * GAP-LEARNING-HOME-06: replaced hard-coded tailwind gray-100/200 blocks with
 * design-system Skeleton components so the loading state respects dark/theme
 * tokens via CSS variables (--line2, --line, --panel).
 */
export default function Loading() {
  return (
    <div className="space-y-4 p-6" aria-label="Loading" aria-busy="true">
      <SkeletonBar w={200} h={28} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <SkeletonBar w="100%" h={256} />
    </div>
  );
}
