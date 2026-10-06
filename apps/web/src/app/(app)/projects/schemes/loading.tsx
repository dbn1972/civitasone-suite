// GAP-PROJECTS-SCHEMES-03: the schemes page renders a 4-card StatGrid
// (Total/Active/Total Allocation/Released) above the table, but this skeleton
// omitted the stat row, so the page jumped on load. Mirror the real page shape
// (4 stat placeholders + a table block), matching the sibling list/loading.tsx.
export default function SchemesLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-4 w-48 rounded bg-slate-200" />
        <div className="h-9 w-48 rounded bg-slate-200" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-200" />
          ))}
        </div>
        <div className="h-80 rounded-xl bg-slate-200" />
      </div>
    </div>
  );
}
