export default function Loading() {
  return (
    <div className="space-y-4 p-6" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
      {/* Five placeholders — the page renders five StatCards (Progress
          Entries, On Track, Delayed, Completed, Open Issues); a four-item
          skeleton caused a layout shift when the fifth card appeared. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
      {/* Tabs row (Progress / Issues) above the table. */}
      <div className="flex gap-2">
        <div className="h-9 w-24 animate-pulse rounded-lg bg-gray-100" />
        <div className="h-9 w-24 animate-pulse rounded-lg bg-gray-100" />
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-gray-100" />
    </div>
  );
}
