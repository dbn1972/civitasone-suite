// GAP-TENANT-HOME-03: the loading skeleton was a generic four-stat dashboard
// shape that did not match the /tenant tile hub. Render a grid of ~12 rounded
// tile-shaped placeholders instead, matching ModuleHub's LinkTiles layout.
export default function TenantLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-4 w-40 rounded bg-slate-200" />
        <div className="h-9 w-64 rounded bg-slate-200" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-slate-200" />
          ))}
        </div>
      </div>
    </div>
  );
}
