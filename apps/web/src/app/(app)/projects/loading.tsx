// GAP-PROJECTS-HOME-03: the projects hub (page.tsx -> ModuleHub) is a header
// plus a 3-column LinkTiles grid of 12 tiles — it has neither the four stat
// cards nor the large table this skeleton used to paint, so navigating to
// /projects flashed a layout that never appears. This also serves as the
// fallback for nested routes without their own loading.tsx (e.g. /projects/new),
// so it mirrors the hub shape rather than a list page. Nested list-style routes
// (fund-releases, milestones, schemes, …) each already ship their own loading.tsx.
export default function ProjectsLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-6">
        {/* Page header: title + subtitle */}
        <div className="space-y-3">
          <div className="h-8 w-80 rounded bg-slate-200" />
          <div className="h-4 w-full max-w-2xl rounded bg-slate-200" />
        </div>
        {/* 12 navigation tiles in a 3-column grid, matching LinkTiles columns="three" */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-slate-200" />
          ))}
        </div>
      </div>
    </div>
  );
}
