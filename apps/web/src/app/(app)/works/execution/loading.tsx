import { SkeletonBar } from "@/app/_components/ds/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-4 p-6" role="status" aria-label="Loading">
      <SkeletonBar w={192} h={32} />
      {/* Five placeholders — the page renders five StatCards (Progress
          Entries, On Track, Delayed, Completed, Open Issues); a four-item
          skeleton caused a layout shift when the fifth card appeared. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <SkeletonBar key={i} h={96} style={{ borderRadius: 8 }} />
        ))}
      </div>
      {/* Tabs row (Progress / Issues) above the table. */}
      <div className="flex gap-2">
        <SkeletonBar w={96} h={36} style={{ borderRadius: 8 }} />
        <SkeletonBar w={96} h={36} style={{ borderRadius: 8 }} />
      </div>
      <SkeletonBar h={256} style={{ borderRadius: 8 }} />
    </div>
  );
}
