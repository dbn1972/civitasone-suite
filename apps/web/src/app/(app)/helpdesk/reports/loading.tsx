export default function HelpdeskReportsLoading() {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-4 w-48 rounded bg-slate-200" />
        <div className="h-9 w-52 rounded bg-slate-200" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-200" />
          ))}
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="h-60 rounded-xl bg-slate-200" />
          <div className="h-60 rounded-xl bg-slate-200" />
        </div>
      </div>
    </main>
  );
}
