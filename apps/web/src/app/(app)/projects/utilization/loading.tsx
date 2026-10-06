// GAP-PROJECTS-UTILIZATION-04: match the real page shape (header + 4 stat
// cards + table) instead of a single bare `.skeleton` block, so the page does
// not jump on load once wired to a loader.
export default function UtilizationLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-4 w-40 rounded bg-slate-200" />
        <div className="h-9 w-72 rounded bg-slate-200" />
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
