export default function ExperimentsLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5" role="status" aria-label="Loading experiments…">
        <div className="h-4 w-44 rounded bg-slate-200" />
        <div className="h-9 w-72 rounded bg-slate-200" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-200" />
          ))}
        </div>
        <div className="h-80 rounded-xl bg-slate-200" />
        <span className="sr-only">Loading experiments…</span>
      </div>
    </div>
  );
}
