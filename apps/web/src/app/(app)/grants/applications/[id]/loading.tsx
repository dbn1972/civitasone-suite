export default function GrantApplicationDetailLoading() {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        {/* breadcrumb skeleton */}
        <div className="h-4 w-48 rounded bg-slate-200" />
        {/* page title skeleton */}
        <div className="h-9 w-72 rounded bg-slate-200" />
        <div className="h-4 w-40 rounded bg-slate-200" />
        {/* detail card skeleton */}
        <div className="rounded-xl bg-white p-6 shadow-sm space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <div className="h-3 w-20 rounded bg-slate-200" />
                <div className="h-5 w-36 rounded bg-slate-200" />
              </div>
            ))}
          </div>
        </div>
        {/* table skeleton */}
        <div className="h-48 rounded-xl bg-slate-200" />
      </div>
    </main>
  );
}
