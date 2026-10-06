// GAP-PROJECTS-DETAIL-RISKS-05: tasks/ had no loading.tsx and inherited the
// generic [id] detail skeleton, causing a layout jump into header + 4 stat
// tiles + table.
export default function TasksLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-6">
        <div className="space-y-3">
          <div className="h-4 w-32 rounded bg-slate-200" />
          <div className="h-8 w-40 rounded bg-slate-200" />
        </div>
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
