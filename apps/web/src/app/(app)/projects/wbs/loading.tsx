// GAP-PROJECTS-WBS-05: the WBS page (page.tsx) is a header, a 4-card StatGrid
// (Total/Completed/In Progress/Not Started) and a card holding the WBS tree.
// The old single bare `.skeleton` block matched none of that, so the page
// jumped on load. This mirrors the real page shape, matching the sibling
// list/loading.tsx skeleton convention.
export default function WbsLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-4 w-48 rounded bg-slate-200" />
        <div className="h-9 w-80 rounded bg-slate-200" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-200" />
          ))}
        </div>
        <div className="space-y-2 rounded-xl bg-white p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-9 rounded bg-slate-200"
              style={{ marginInlineStart: (i % 3) * 24 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
